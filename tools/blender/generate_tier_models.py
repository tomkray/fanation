"""
Não É Um Fã: reproducible night-neon city pieces, in metres, exported as
Draco-compressed GLB. Material and object names are a contract with the web
engine (it re-tints the white parts per instance):

  houses    Walls (pastel per house) · Roof (dark fandom tint) · Neon (fandom glow)
            · Window (warm glow) · Door · Chimney
  tower     base: Podium*; body (1 m tall, scaled by fan count): Shaft, Fin*, Seam*;
            top (moved to the body's top): Cap*, Penthouse*, Antenna, Beacon;
            materials Podium · Shaft · Neon · Window · Antenna
  plaza     Podium · Neon · Window
  tree      Trunk · Leaves
  car       Body (paint per car) · Glass · Wheel · Headlight · Taillight
  lamp      Pole · LampGlow          bench  Wood · Metal

  blender --background --python tools/blender/generate_tier_models.py
"""

import math
import os
import sys

import bpy

OUTPUT_DIR = os.path.abspath("./public/assets/models")
_materials = {}


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _materials.clear()


def material(name, rgba, roughness=0.7, emission=0.0):
    if name in _materials:
        return _materials[name]
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    if emission > 0:
        bsdf.inputs["Emission Color"].default_value = rgba
        bsdf.inputs["Emission Strength"].default_value = emission
    _materials[name] = mat
    return mat


def palette():
    return {
        "Walls": material("Walls", (1.0, 1.0, 1.0, 1.0)),
        "Roof": material("Roof", (1.0, 1.0, 1.0, 1.0), roughness=0.55),
        "Neon": material("Neon", (1.0, 1.0, 1.0, 1.0), emission=3.0),
        "Window": material("Window", (1.0, 0.72, 0.32, 1.0), emission=2.5),
        "Door": material("Door", (0.22, 0.16, 0.20, 1.0)),
        "Chimney": material("Chimney", (0.20, 0.22, 0.32, 1.0)),
        "Podium": material("Podium", (0.16, 0.18, 0.26, 1.0), roughness=0.5),
        "Shaft": material("Shaft", (0.10, 0.12, 0.20, 1.0), roughness=0.25),
        "Antenna": material("Antenna", (0.55, 0.58, 0.68, 1.0), roughness=0.4),
        "Trunk": material("Trunk", (0.30, 0.20, 0.16, 1.0)),
        "Leaves": material("Leaves", (0.16, 0.48, 0.30, 1.0)),
        "Pitch": material("Pitch", (0.18, 0.55, 0.28, 1.0), roughness=0.9),
        "Pool": material("Pool", (0.25, 0.75, 1.0, 1.0), emission=1.2),
    }


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def finish(obj, name, mat):
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return assign(obj, mat)


def block(name, w, d, h, z0, mat, x=0.0, y=0.0):
    """Box standing on z0 (Blender Z-up; glTF export makes it Y-up and the -Y front faces +Z)."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(x, y, z0 + h / 2.0))
    obj = bpy.context.active_object
    obj.scale = (w, d, h)
    return finish(obj, name, mat)


def cylinder(name, radius, height, z0, mat, x=0.0, y=0.0, vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=(x, y, z0 + height / 2.0))
    return finish(bpy.context.active_object, name, mat)


def cone(name, radius, height, z0, mat, x=0.0, y=0.0, vertices=12):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=0.0, depth=height, location=(x, y, z0 + height / 2.0))
    return finish(bpy.context.active_object, name, mat)


def blob(name, radius, center, mat, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=radius, location=center)
    return finish(bpy.context.active_object, name, mat)


def gable_roof(name, w, d, h, z0, mat, overhang=0.5, x=0.0, y=0.0):
    hw, hd = w / 2.0 + overhang, d / 2.0 + overhang
    verts = [(-hw, -hd, z0), (hw, -hd, z0), (hw, hd, z0), (-hw, hd, z0), (-hw, 0, z0 + h), (hw, 0, z0 + h)]
    faces = [(0, 1, 5, 4), (3, 4, 5, 2), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(vx + x, vy + y, vz) for vx, vy, vz in verts], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return assign(obj, mat)


def window_row(prefix, xs, z, front_y, mat, w=1.1, h=1.1):
    for i, x in enumerate(xs):
        block(f"{prefix}{i}", w, 0.16, h, z, mat, x=x, y=front_y)


def eave_neon(name, w, d, z, mat, x=0.0, y=0.0):
    """Thin glowing strip wrapping the house just under the roof."""
    block(name, w + 0.12, d + 0.12, 0.22, z, mat, x=x, y=y)


def rim(name, w, d, z, mat, thickness=0.35, height=0.3):
    """Glowing outline along the four top edges (not a slab, so the surface stays dark)."""
    block(f"{name}N", w, thickness, height, z, mat, y=d / 2.0)
    block(f"{name}S", w, thickness, height, z, mat, y=-d / 2.0)
    block(f"{name}E", thickness, d, height, z, mat, x=w / 2.0)
    block(f"{name}W", thickness, d, height, z, mat, x=-w / 2.0)


# ---------------------------------------------------------------- homes


def tier_4_common(m):
    """Cottage."""
    block("Body", 6.0, 6.0, 4.0, 0.0, m["Walls"])
    eave_neon("Eave", 6.0, 6.0, 3.8, m["Neon"])
    gable_roof("Roof", 6.0, 6.0, 3.0, 4.0, m["Roof"])
    block("Door", 1.3, 0.18, 2.3, 0.0, m["Door"], y=-3.05)
    window_row("Window", (-1.9, 1.9), 1.5, -3.05, m["Window"])
    block("Chimney", 0.9, 0.9, 2.2, 5.2, m["Chimney"], x=1.6, y=1.2)


def tier_3_uncommon(m):
    """Two-storey house."""
    block("Body", 7.0, 6.0, 7.0, 0.0, m["Walls"])
    eave_neon("Eave", 7.0, 6.0, 6.8, m["Neon"])
    gable_roof("Roof", 7.0, 6.0, 3.2, 7.0, m["Roof"])
    block("Door", 1.3, 0.18, 2.3, 0.0, m["Door"], y=-3.05)
    window_row("WindowLow", (-2.2, 2.2), 1.5, -3.05, m["Window"])
    window_row("WindowHigh", (-2.2, 0.0, 2.2), 4.3, -3.05, m["Window"])
    block("Chimney", 0.9, 0.9, 2.4, 8.4, m["Chimney"], x=-2.2, y=1.4)


def tier_2_rare(m):
    """Townhouse with a corner tower."""
    block("Body", 8.0, 6.5, 6.0, 0.0, m["Walls"], x=-0.8)
    eave_neon("Eave", 8.0, 6.5, 5.8, m["Neon"], x=-0.8)
    gable_roof("Roof", 8.0, 6.5, 3.2, 6.0, m["Roof"], x=-0.8)
    block("Door", 1.5, 0.18, 2.5, 0.0, m["Door"], x=-0.8, y=-3.3)
    window_row("Window", (-3.6, 2.0), 1.7, -3.3, m["Window"])
    window_row("WindowHigh", (-3.6, -0.8, 2.0), 4.0, -3.3, m["Window"], w=1.0, h=1.0)
    block("Tower", 3.4, 3.4, 9.5, 0.0, m["Walls"], x=4.0, y=-1.4)
    eave_neon("TowerEave", 3.4, 3.4, 9.3, m["Neon"], x=4.0, y=-1.4)
    cone("TowerRoof", 2.7, 3.8, 9.5, m["Roof"], x=4.0, y=-1.4, vertices=4)
    window_row("TowerWindow", (4.0,), 6.2, -3.15, m["Window"], w=1.0, h=1.4)


def tier_1_epic(m):
    """Modern villa: flat roofs, big glowing windows, rooftop sign."""
    block("Body", 10.0, 7.5, 5.0, 0.0, m["Walls"])
    block("Upper", 7.0, 6.0, 4.5, 5.0, m["Walls"], x=-1.2, y=0.4)
    block("RoofSlab", 10.4, 7.9, 0.5, 5.0, m["Roof"])
    block("RoofTop", 7.4, 6.4, 0.5, 9.5, m["Roof"], x=-1.2, y=0.4)
    eave_neon("Eave", 10.0, 7.5, 4.7, m["Neon"])
    eave_neon("UpperEave", 7.0, 6.0, 9.2, m["Neon"], x=-1.2, y=0.4)
    block("Door", 2.0, 0.18, 3.0, 0.0, m["Door"], x=3.0, y=-3.8)
    block("GlassWall", 5.0, 0.18, 3.2, 0.8, m["Window"], x=-1.8, y=-3.8)
    window_row("WindowHigh", (-3.6, -1.2, 1.2), 6.4, -2.65, m["Window"], w=1.6, h=1.6)
    block("Sign", 3.6, 0.3, 1.4, 10.0, m["Neon"], x=-1.2, y=-2.6)


# ---------------------------------------------------------------- landmarks


def tower(m):
    """The idol tower. Shaft and ShaftNeon are exactly 1 m tall; the engine scales them."""
    block("Podium", 30.0, 30.0, 3.0, 0.0, m["Podium"])
    rim("PodiumGlow", 30.2, 30.2, 2.8, m["Neon"])
    block("Shaft", 14.0, 14.0, 1.0, 0.0, m["Shaft"])
    for sx in (-1, 1):
        for sy in (-1, 1):
            block(f"Fin{sx}{sy}", 0.7, 0.7, 1.0, 0.0, m["Neon"], x=sx * 7.0, y=sy * 7.0)
    for side, (x, y, w, d) in enumerate(((0, -7.05, 0.6, 0.12), (0, 7.05, 0.6, 0.12), (-7.05, 0, 0.12, 0.6), (7.05, 0, 0.12, 0.6))):
        block(f"Seam{side}", w, d, 1.0, 0.0, m["Neon"], x=x, y=y)
    block("Cap", 15.0, 15.0, 1.2, 0.0, m["Podium"])
    rim("CapGlow", 15.1, 15.1, 1.0, m["Neon"], thickness=0.3, height=0.25)
    block("Penthouse", 9.0, 9.0, 3.5, 1.2, m["Shaft"])
    block("PenthouseWindows", 9.15, 9.15, 1.2, 2.4, m["Window"])
    cylinder("Antenna", 0.35, 9.0, 4.7, m["Antenna"], vertices=6)
    blob("Beacon", 0.9, (0.0, 0.0, 14.0), m["Neon"])


def plaza(m):
    cylinder("Base", 22.0, 1.6, 0.0, m["Podium"], vertices=40)
    cylinder("Ring", 22.3, 0.35, 1.45, m["Neon"], vertices=40)
    cylinder("Inner", 14.0, 0.6, 1.6, m["Podium"], vertices=40)
    cylinder("InnerRing", 14.2, 0.25, 2.0, m["Neon"], vertices=40)
    cylinder("Projector", 5.0, 2.2, 2.2, m["Shaft"], vertices=24)
    cylinder("Lens", 4.2, 0.3, 4.4, m["Window"], vertices=24)


def tree(m):
    cylinder("Trunk", 0.45, 2.4, 0.0, m["Trunk"], vertices=6)
    blob("Canopy", 2.2, (0.0, 0.0, 4.0), m["Leaves"])
    blob("CanopyTop", 1.5, (0.4, 0.3, 5.6), m["Leaves"])


# ---------------------------------------------------------------- street furniture


def car(m):
    """Compact city car, 4.4 m long; the front (-Y) becomes +Z in the engine."""
    body = material("Body", (1.0, 1.0, 1.0, 1.0), roughness=0.35)
    glass = material("Glass", (0.08, 0.10, 0.16, 1.0), roughness=0.1)
    wheel = material("Wheel", (0.05, 0.05, 0.06, 1.0))
    head = material("Headlight", (1.0, 0.97, 0.88, 1.0), emission=4.0)
    tail = material("Taillight", (1.0, 0.12, 0.18, 1.0), emission=4.0)
    block("Chassis", 2.0, 4.4, 0.9, 0.35, body)
    block("Cabin", 1.8, 2.4, 0.75, 1.25, body, y=0.3)
    block("Windshield", 1.82, 0.12, 0.6, 1.3, glass, y=-0.92)
    block("RearWindow", 1.82, 0.12, 0.6, 1.3, glass, y=1.52)
    block("SideWindows", 1.84, 2.0, 0.5, 1.4, glass, y=0.3)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cylinder(f"Wheel{sx}{sy}", 0.42, 0.3, 0.0, wheel, vertices=10)
            obj = bpy.context.active_object
            obj.rotation_euler = (0.0, 1.5708, 0.0)
            obj.location = (sx * 0.95, sy * 1.4, 0.42)
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        block(f"Headlight{sx}", 0.45, 0.1, 0.22, 0.85, head, x=sx * 0.65, y=-2.22)
        block(f"Taillight{sx}", 0.45, 0.1, 0.2, 0.9, tail, x=sx * 0.65, y=2.22)


def street_lamp(m):
    pole = material("Pole", (0.22, 0.24, 0.32, 1.0), roughness=0.4)
    glow = material("LampGlow", (1.0, 0.86, 0.62, 1.0), emission=5.0)
    cylinder("Base", 0.35, 0.6, 0.0, pole, vertices=8)
    cylinder("Pole", 0.12, 6.4, 0.6, pole, vertices=8)
    block("Arm", 0.16, 1.6, 0.16, 6.8, pole, y=-0.7)
    block("Head", 0.55, 0.9, 0.28, 6.6, pole, y=-1.4)
    block("Bulb", 0.45, 0.8, 0.08, 6.55, glow, y=-1.4)


def bench(m):
    wood = material("Wood", (0.58, 0.38, 0.24, 1.0))
    metal = material("Metal", (0.20, 0.22, 0.28, 1.0), roughness=0.4)
    block("Seat", 2.2, 0.6, 0.12, 0.45, wood)
    block("Back", 2.2, 0.1, 0.5, 0.65, wood, y=0.3)
    for sx in (-1, 1):
        block(f"Leg{sx}", 0.1, 0.6, 0.45, 0.0, metal, x=sx * 0.95)


BUILDERS = {
    "tier_1_epic": tier_1_epic,
    "tier_2_rare": tier_2_rare,
    "tier_3_uncommon": tier_3_uncommon,
    "tier_4_common": tier_4_common,
    "tower": tower,
    "plaza": plaza,
    "tree": tree,
    "car": car,
    "street_lamp": street_lamp,
    "bench": bench,
}


# ---------------------------------------------------------------- variety: same materials, new silhouettes


def _rotated_cylinder(name, radius, depth, location, mat, vertices=24):
    """Cylinder lying along Y (a lens or a drum facing the street)."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=(math.pi / 2.0, 0.0, 0.0))
    return finish(bpy.context.active_object, name, mat)


def home_cottage_round(m):
    """Cottage variant: a round hut with a cone roof."""
    cylinder("Body", 3.4, 4.0, 0.0, m["Walls"], vertices=16)
    cylinder("Eave", 3.55, 0.25, 3.8, m["Neon"], vertices=16)
    cone("Roof", 4.2, 3.4, 4.0, m["Roof"], vertices=16)
    block("Door", 1.2, 0.2, 2.2, 0.0, m["Door"], y=-3.35)
    window_row("Window", (-1.9, 1.9), 1.6, -2.85, m["Window"], w=0.9, h=0.9)
    block("Chimney", 0.7, 0.7, 2.0, 5.2, m["Chimney"], x=1.4)


def home_house_l(m):
    """House variant: an L-shaped home with two gables."""
    block("Body", 7.0, 5.0, 5.0, 0.0, m["Walls"], x=-0.5, y=-0.8)
    block("Wing", 4.0, 5.0, 5.0, 0.0, m["Walls"], x=2.5, y=2.2)
    eave_neon("Eave", 7.0, 5.0, 4.8, m["Neon"], x=-0.5, y=-0.8)
    eave_neon("WingEave", 4.0, 5.0, 4.8, m["Neon"], x=2.5, y=2.2)
    gable_roof("Roof", 7.0, 5.0, 2.8, 5.0, m["Roof"], x=-0.5, y=-0.8)
    gable_roof("WingRoof", 4.0, 5.0, 2.4, 5.0, m["Roof"], x=2.5, y=2.2)
    block("Door", 1.3, 0.2, 2.4, 0.0, m["Door"], x=-0.5, y=-3.35)
    window_row("Window", (-3.0, 2.0), 1.7, -3.35, m["Window"])


def home_townhouse_shop(m):
    """Townhouse variant: three storeys with a shop and a glowing awning."""
    block("Body", 8.0, 6.5, 9.0, 0.0, m["Walls"])
    block("ShopWindow", 6.0, 0.18, 2.4, 0.6, m["Window"], y=-3.32)
    block("Awning", 8.4, 1.6, 0.35, 3.3, m["Neon"], y=-3.9)
    window_row("WindowMid", (-2.6, 0.0, 2.6), 4.9, -3.32, m["Window"], w=1.2, h=1.3)
    window_row("WindowTop", (-2.6, 0.0, 2.6), 7.1, -3.32, m["Window"], w=1.2, h=1.3)
    eave_neon("Eave", 8.0, 6.5, 8.8, m["Neon"])
    gable_roof("Roof", 8.0, 6.5, 2.6, 9.0, m["Roof"])


def home_villa_pool(m):
    """Villa variant: flat-roof modern villa with a glowing pool."""
    block("Body", 9.0, 7.0, 4.2, 0.0, m["Walls"], x=-1.0, y=0.8)
    block("Upper", 5.5, 5.5, 3.8, 4.2, m["Walls"], x=-2.2, y=1.4)
    block("RoofSlab", 9.4, 7.4, 0.4, 4.2, m["Roof"], x=-1.0, y=0.8)
    block("RoofTop", 5.9, 5.9, 0.4, 8.0, m["Roof"], x=-2.2, y=1.4)
    eave_neon("Eave", 9.0, 7.0, 3.9, m["Neon"], x=-1.0, y=0.8)
    block("GlassWall", 6.0, 0.18, 2.8, 0.6, m["Window"], x=-1.0, y=-2.75)
    block("Pool", 4.2, 3.2, 0.3, 0.0, m["Pool"], x=4.4, y=-2.4)
    block("PoolEdge", 4.8, 3.8, 0.15, 0.0, m["Podium"], x=4.4, y=-2.4)


def tower_round(m):
    """Tower variant: a round shaft; body 1 m tall, scaled by fans like the classic tower."""
    cylinder("PodiumBase", 14.0, 3.0, 0.0, m["Podium"], vertices=32)
    cylinder("PodiumGlow", 14.2, 0.3, 2.8, m["Neon"], vertices=32)
    cylinder("Shaft", 7.0, 1.0, 0.0, m["Shaft"], vertices=24)
    for i in range(4):
        a = i * math.pi / 2.0
        block(f"Seam{i}", 0.5, 0.5, 1.0, 0.0, m["Neon"], x=7.0 * math.cos(a), y=7.0 * math.sin(a))
    cylinder("Cap", 7.6, 1.2, 0.0, m["Podium"], vertices=24)
    cylinder("CapGlow", 7.7, 0.25, 1.0, m["Neon"], vertices=24)
    cylinder("PenthouseWindows", 4.5, 1.4, 1.2, m["Window"], vertices=16)
    cone("Antenna", 0.6, 9.0, 2.6, m["Antenna"], vertices=6)
    blob("Beacon", 0.9, (0.0, 0.0, 11.8), m["Neon"])


def tower_slab(m):
    """Tower variant: a wide slab tower for idols with a big following."""
    block("PodiumBase", 30.0, 30.0, 3.0, 0.0, m["Podium"])
    rim("PodiumGlow", 30.2, 30.2, 2.8, m["Neon"])
    block("Shaft", 22.0, 10.0, 1.0, 0.0, m["Shaft"])
    for sx in (-1, 1):
        block(f"Fin{sx}", 0.7, 10.4, 1.0, 0.0, m["Neon"], x=sx * 11.0)
    block("SeamFront", 22.2, 0.3, 1.0, 0.0, m["Neon"], y=-5.0)
    block("Cap", 23.0, 11.0, 1.2, 0.0, m["Podium"])
    rim("CapGlow", 23.1, 11.1, 1.0, m["Neon"], thickness=0.3, height=0.25)
    block("PenthouseWindows", 12.0, 7.0, 3.0, 1.2, m["Window"])
    blob("Beacon", 0.9, (0.0, 0.0, 6.0), m["Neon"])


def tower_needle(m):
    """Mythic skyscraper: a thin needle. Shaft is 1 m so the engine can grow it."""
    cylinder("PodiumBase", 9.0, 3.0, 0.0, m["Podium"], vertices=24)
    cylinder("PodiumGlow", 9.2, 0.28, 2.8, m["Neon"], vertices=24)
    cylinder("Shaft", 4.2, 1.0, 0.0, m["Shaft"], vertices=20)
    for i in range(4):
        a = i * math.pi / 2.0
        block(f"Seam{i}", 0.35, 0.35, 1.0, 0.0, m["Neon"], x=4.2 * math.cos(a), y=4.2 * math.sin(a))
    cylinder("Cap", 4.6, 1.4, 0.0, m["Podium"], vertices=20)
    cylinder("CapGlow", 4.7, 0.22, 1.2, m["Neon"], vertices=20)
    cone("Antenna", 0.7, 16.0, 1.4, m["Antenna"], vertices=8)
    blob("Beacon", 0.7, (0.0, 0.0, 17.8), m["Neon"])


def tower_deco(m):
    """Mythic skyscraper: stepped art-deco crown on a square shaft."""
    block("PodiumBase", 28.0, 28.0, 3.0, 0.0, m["Podium"])
    rim("PodiumGlow", 28.2, 28.2, 2.8, m["Neon"])
    block("Shaft", 12.0, 12.0, 1.0, 0.0, m["Shaft"])
    for sx in (-1, 1):
        for sy in (-1, 1):
            block(f"Fin{sx}{sy}", 1.1, 1.1, 1.0, 0.0, m["Neon"], x=sx * 6.0, y=sy * 6.0)
    block("Cap", 16.0, 16.0, 1.4, 0.0, m["Podium"])
    rim("CapGlow", 16.2, 16.2, 1.15, m["Neon"], thickness=0.35, height=0.28)
    block("Penthouse", 8.0, 8.0, 3.2, 1.4, m["Shaft"])
    block("PenthouseWindows", 8.2, 8.2, 1.2, 2.4, m["Window"])
    for i, x in enumerate((-3.2, 0.0, 3.2)):
        block(f"Crown{i}", 1.1, 1.1, 3.6, 4.6, m["Neon"], x=x)
    blob("Beacon", 0.85, (0.0, 0.0, 8.8), m["Neon"])


def tower_glass(m):
    """Mythic skyscraper: a wide glass slab with glowing window bands."""
    block("PodiumBase", 30.0, 30.0, 3.0, 0.0, m["Podium"])
    rim("PodiumGlow", 30.2, 30.2, 2.8, m["Neon"])
    block("Shaft", 20.0, 8.0, 1.0, 0.0, m["Shaft"])
    block("SeamFront", 20.2, 0.2, 1.0, 0.0, m["Window"], y=-4.05)
    block("SeamBack", 20.2, 0.2, 1.0, 0.0, m["Window"], y=4.05)
    for sx in (-1, 1):
        block(f"Fin{sx}", 0.35, 8.2, 1.0, 0.0, m["Neon"], x=sx * 10.1)
    block("Cap", 21.0, 9.0, 1.2, 0.0, m["Podium"])
    rim("CapGlow", 21.1, 9.1, 1.0, m["Neon"], thickness=0.28, height=0.22)
    block("PenthouseWindows", 14.0, 6.0, 2.4, 1.2, m["Window"])
    blob("Beacon", 0.8, (0.0, 0.0, 4.4), m["Neon"])


def tower_spire(m):
    """Apex megatower: a tall spire over a round shaft."""
    cylinder("PodiumBase", 13.0, 3.0, 0.0, m["Podium"], vertices=28)
    cylinder("PodiumGlow", 13.2, 0.3, 2.8, m["Neon"], vertices=28)
    cylinder("Shaft", 6.2, 1.0, 0.0, m["Shaft"], vertices=20)
    for i in range(6):
        a = i * math.pi / 3.0
        block(f"Seam{i}", 0.4, 0.4, 1.0, 0.0, m["Neon"], x=6.2 * math.cos(a), y=6.2 * math.sin(a))
    cylinder("Cap", 6.8, 1.6, 0.0, m["Podium"], vertices=20)
    cylinder("CapGlow", 6.95, 0.24, 1.35, m["Neon"], vertices=20)
    cone("Antenna", 1.4, 22.0, 1.6, m["Antenna"], vertices=8)
    blob("Beacon", 1.0, (0.0, 0.0, 24.0), m["Neon"])


def tower_twist(m):
    """Apex megatower: two offset shafts that read as a twist from above."""
    block("PodiumBase", 30.0, 30.0, 3.0, 0.0, m["Podium"])
    rim("PodiumGlow", 30.2, 30.2, 2.8, m["Neon"])
    block("Shaft", 11.0, 11.0, 1.0, 0.0, m["Shaft"], x=1.6, y=1.6)
    block("SeamTwist", 11.0, 11.0, 1.0, 0.0, m["Shaft"], x=-1.6, y=-1.6)
    for sx in (-1, 1):
        block(f"Fin{sx}", 0.55, 14.0, 1.0, 0.0, m["Neon"], x=sx * 7.4)
    block("Cap", 16.0, 16.0, 1.3, 0.0, m["Podium"])
    rim("CapGlow", 16.2, 16.2, 1.05, m["Neon"])
    block("PenthouseWindows", 8.0, 8.0, 2.8, 1.3, m["Window"])
    blob("Beacon", 0.95, (0.0, 0.0, 5.0), m["Neon"])


def tower_crown(m):
    """Apex megatower: a wide shaft with a crown of fins."""
    block("PodiumBase", 32.0, 32.0, 3.0, 0.0, m["Podium"])
    rim("PodiumGlow", 32.2, 32.2, 2.8, m["Neon"])
    block("Shaft", 16.0, 16.0, 1.0, 0.0, m["Shaft"])
    for i in range(8):
        a = i * math.pi / 4.0
        block(f"Fin{i}", 1.2, 1.2, 1.0, 0.0, m["Neon"], x=8.2 * math.cos(a), y=8.2 * math.sin(a))
    block("Cap", 18.0, 18.0, 1.5, 0.0, m["Podium"])
    rim("CapGlow", 18.2, 18.2, 1.25, m["Neon"], thickness=0.4, height=0.3)
    for i, (x, y) in enumerate(((-5, 0), (5, 0), (0, -5), (0, 5), (-3.4, -3.4), (3.4, 3.4), (-3.4, 3.4), (3.4, -3.4))):
        block(f"Crown{i}", 1.3, 1.3, 4.8, 1.5, m["Neon"], x=x, y=y)
    blob("Beacon", 1.15, (0.0, 0.0, 7.0), m["Neon"])


def venue_music(m):
    """Music City landmark: a round concert arena with a stage screen and spotlights."""
    block("Plinth", 46.0, 46.0, 1.0, 0.0, m["Podium"])
    cylinder("Bowl", 19.0, 9.0, 1.0, m["Walls"], vertices=32)
    cylinder("RoofRing", 20.2, 0.5, 10.0, m["Neon"], vertices=32)
    cone("Roof", 19.6, 6.5, 10.0, m["Roof"], vertices=16)
    block("StageScreen", 16.0, 0.6, 6.0, 2.5, m["Window"], y=-19.2)
    block("Steps", 18.0, 4.0, 1.0, 1.0, m["Podium"], y=-21.0)
    for i in range(8):
        a = i * math.pi / 4.0
        cone(f"Spot{i}", 1.0, 3.0, 10.5, m["Neon"], x=17.5 * math.cos(a), y=17.5 * math.sin(a), vertices=8)


def venue_sports(m):
    """Stadium City landmark: an open stadium with a pitch, roofed stands and floodlights."""
    block("Plinth", 46.0, 46.0, 1.0, 0.0, m["Podium"])
    block("StandNorth", 42.0, 6.0, 8.0, 1.0, m["Walls"], y=16.0)
    block("StandSouth", 42.0, 6.0, 8.0, 1.0, m["Walls"], y=-16.0)
    block("StandEast", 6.0, 26.0, 6.0, 1.0, m["Walls"], x=18.0)
    block("StandWest", 6.0, 26.0, 6.0, 1.0, m["Walls"], x=-18.0)
    block("Pitch", 30.0, 26.0, 0.4, 1.0, m["Pitch"])
    block("PitchLine", 0.4, 26.0, 0.05, 1.4, m["Neon"])
    block("CanopyNorth", 42.0, 7.0, 0.6, 9.0, m["Roof"], y=16.5)
    block("CanopySouth", 42.0, 7.0, 0.6, 9.0, m["Roof"], y=-16.5)
    rim("CanopyGlow", 42.2, 40.2, 9.5, m["Neon"], thickness=0.3, height=0.25)
    for i, (x, y) in enumerate(((-21, -19), (21, -19), (-21, 19), (21, 19))):
        cylinder(f"Mast{i}", 0.5, 20.0, 1.0, m["Podium"], x=x, y=y, vertices=8)
        block(f"Flood{i}", 3.0, 1.0, 1.6, 21.0, m["Window"], x=x, y=y)


def venue_creators(m):
    """Creator City landmark: a studio shaped like a giant camera with a play button."""
    block("Plinth", 46.0, 46.0, 1.0, 0.0, m["Podium"])
    block("Body", 30.0, 18.0, 15.0, 1.0, m["Walls"])
    eave_neon("Eave", 30.0, 18.0, 15.8, m["Neon"])
    _rotated_cylinder("Lens", 6.5, 6.0, (-4.0, -11.5, 8.5), m["Roof"])
    _rotated_cylinder("LensGlass", 4.6, 6.4, (-4.0, -11.6, 8.5), m["Window"])
    block("Viewfinder", 9.0, 7.0, 5.0, 16.0, m["Roof"], x=7.0)
    cone("PlayButton", 3.0, 0.8, 0.0, m["Neon"], x=9.0, y=-9.4, vertices=3)
    blob("RecordLight", 1.0, (13.0, -9.2, 13.0), m["Neon"])
    block("Carpet", 6.0, 6.0, 0.15, 1.0, m["Neon"], x=9.0, y=-12.0)


def venue_community(m):
    """Community City landmark: a town hall with columns and a clock tower."""
    block("Plinth", 46.0, 46.0, 1.0, 0.0, m["Podium"])
    block("Hall", 32.0, 18.0, 10.0, 1.0, m["Walls"], y=2.0)
    eave_neon("Eave", 32.0, 18.0, 10.8, m["Neon"], y=2.0)
    gable_roof("Roof", 32.0, 18.0, 4.5, 11.0, m["Roof"], y=2.0)
    for i, x in enumerate((-12.0, -7.2, -2.4, 2.4, 7.2, 12.0)):
        cylinder(f"Column{i}", 0.8, 9.0, 1.0, m["Podium"], x=x, y=-8.2, vertices=10)
    block("Steps", 28.0, 4.0, 1.0, 1.0, m["Podium"], y=-11.0)
    block("ClockTower", 7.0, 7.0, 22.0, 1.0, m["Walls"], y=4.0)
    eave_neon("TowerEave", 7.0, 7.0, 22.8, m["Neon"], y=4.0)
    cone("TowerRoof", 5.6, 6.0, 23.0, m["Roof"], y=4.0, vertices=4)
    _rotated_cylinder("ClockFace", 2.2, 0.4, (0.0, 0.4, 18.5), m["Window"], vertices=20)


BUILDERS.update(
    {
        "home_cottage_round": home_cottage_round,
        "home_house_l": home_house_l,
        "home_townhouse_shop": home_townhouse_shop,
        "home_villa_pool": home_villa_pool,
        "tower_round": tower_round,
        "tower_slab": tower_slab,
        "tower_needle": tower_needle,
        "tower_deco": tower_deco,
        "tower_glass": tower_glass,
        "tower_spire": tower_spire,
        "tower_twist": tower_twist,
        "tower_crown": tower_crown,
        "venue_music": venue_music,
        "venue_sports": venue_sports,
        "venue_creators": venue_creators,
        "venue_community": venue_community,
    }
)


def export(name: str) -> str:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    path = os.path.join(OUTPUT_DIR, f"{name}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    return path


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    names = argv or list(BUILDERS)
    for name in names:
        build = BUILDERS[name]
        reset_scene()
        build(palette())
        print(f"exported {export(name)}")
