"""Compara public/library con los .qxf originales de QLC+, canal por canal.

Uso: python scripts/verify-library.py <carpeta de qlcplus>

Lee los originales por su cuenta (otro lenguaje y otro lector de XML que
import-qlcplus.mjs), así un error del importador no se tapa a sí mismo.
"""

import glob
import json
import os
import sys
import xml.etree.ElementTree as ET

NS = "{http://www.qlcplus.org/FixtureDefinition}"
source = sys.argv[1]

index = json.load(open("public/library/index.json", encoding="utf8"))
library = {}
for maker in index["makers"]:
    for fixture in json.load(open(f"public/library/{maker['file']}", encoding="utf8")):
        library[maker["maker"], fixture["model"]] = fixture

errors = []
count = {"perfiles": 0, "modos": 0, "canales": 0, "rangos": 0, "focos": 0}


def check(ok, where, what):
    if not ok:
        errors.append(f"{where}: {what}")


def tidy(text):
    return " ".join((text or "").split())


def text(node, tag):
    found = node.find(NS + tag)
    return tidy(found.text) if found is not None else ""


# Tipo esperado según el preset, escrito aparte del importador.
EXPECTED = {
    "Red": "RED", "Green": "GREEN", "Blue": "BLUE", "White": "WHITE", "Amber": "AMBER", "UV": "UV",
    "Lime": "LIME", "Indigo": "INDIGO", "Cyan": "CYAN", "Magenta": "MAGENTA", "Yellow": "YELLOW",
    "Hue": "HUE", "Saturation": "SATURATION",
}

for path in glob.glob(os.path.join(source, "resources/fixtures/**/*.qxf"), recursive=True):
    root = ET.parse(path).getroot()
    key = (text(root, "Manufacturer"), text(root, "Model"))
    where = " ".join(key)
    count["perfiles"] += 1
    ours = library.pop(key, None)
    if ours is None:
        errors.append(f"{where}: no está")
        continue
    check(ours["type"] == text(root, "Type"), where, "tipo de equipo")

    originals = {}
    for c in root.findall(NS + "Channel"):
        originals.setdefault(tidy(c.get("Name")), c)

    modes = root.findall(NS + "Mode")
    check([m["n"] for m in ours["modes"]] == [tidy(m.get("Name")) for m in modes], where, "modos")
    for mode, our_mode in zip(modes, ours["modes"]):
        count["modos"] += 1
        at = f"{where} [{our_mode['n']}]"
        wanted = {int(c.get("Number")): tidy(c.text) for c in mode.findall(NS + "Channel")}
        check(len(wanted) == len(our_mode["c"]), at, "cantidad de canales")
        for number, name in wanted.items():
            count["canales"] += 1
            ch = ours["channels"][our_mode["c"][number]]
            check(ch["n"] == name, at, f"canal {number + 1}: {ch['n']} en vez de {name}")
            original = originals[name]
            preset = original.get("Preset") or ""
            group = original.find(NS + "Group")
            fine = preset.endswith("Fine") or (group is not None and group.get("Byte") == "1")
            check(("b" in ch) == fine, at, f"{name}: canal fino")
            base = ch.get("b", ch["t"])
            colour = preset.removeprefix("Intensity").removesuffix("Fine") if preset.startswith("Intensity") else ""
            if not preset and group is not None and group.text == "Intensity":
                colour = text(original, "Colour")
            if colour in EXPECTED:
                check(base == EXPECTED[colour], at, f"{name}: {base} en vez de {EXPECTED[colour]}")
            elif preset.startswith("Intensity"):
                check(base == "DIMMER", at, f"{name}: {base} en vez de DIMMER")
            if preset.startswith("PositionPan") or (group is not None and group.text == "Pan"):
                check(base == "PAN", at, f"{name}: {base} en vez de PAN")
            if preset.startswith("PositionTilt") or (group is not None and group.text == "Tilt"):
                check(base == "TILT", at, f"{name}: {base} en vez de TILT")
            if original.get("Default") and base not in ("PAN", "TILT"):
                check(fine or ch.get("d", 0) == int(original.get("Default")), at, f"{name}: valor inicial")

            caps = original.findall(NS + "Capability")
            ranges = [[int(c.get("Min")), int(c.get("Max")), tidy(c.text)] for c in caps]
            if "p" in ch:
                count["rangos"] += len(ranges)
                check([p[:3] for p in ch["p"]] == ranges, at, f"{name}: rangos")
                for p, cap in zip(ch["p"], caps):
                    extra = p[3] if len(p) > 3 else {}
                    kind = cap.get("Preset") or ""
                    gobo = os.path.join(source, "resources/gobos", cap.get("Res1") or "")
                    if kind in ("GoboMacro", "GoboShakeMacro") and os.path.isfile(gobo):
                        check(extra.get("g") == cap.get("Res1"), at, f"{name}: gobo de {p[2]}")
                        check(os.path.exists(f"public/gobos/{cap.get('Res1')}"), at, f"falta {cap.get('Res1')}")
                    if kind == "ColorMacro" and cap.get("Res1"):
                        check(extra.get("c") == [cap.get("Res1").lower()], at, f"{name}: color de {p[2]}")
                    check((extra.get("k") == "open") == (kind == "ShutterOpen"), at, f"{name}: abierto")
            else:
                check(len(ranges) <= 1, at, f"{name}: rangos perdidos")
        heads = [[int(c.text) for c in h.findall(NS + "Channel")] for h in mode.findall(NS + "Head")]
        count["focos"] += len(heads)
        check(our_mode.get("h", []) == heads, at, "focos")

    focus = root.find(f"{NS}Physical/{NS}Focus")
    if focus is not None:
        check(ours.get("phys", {}).get("pan", 0) == float(focus.get("PanMax")), where, "recorrido de pan")
        check(ours.get("phys", {}).get("tilt", 0) == float(focus.get("TiltMax")), where, "recorrido de tilt")

for key in library:
    errors.append(f"{key}: sobra")

print(", ".join(f"{n} {what}" for what, n in count.items()))
print(f"{len(errors)} diferencias")
for e in errors[:40]:
    print("  ", e)
sys.exit(bool(errors))
