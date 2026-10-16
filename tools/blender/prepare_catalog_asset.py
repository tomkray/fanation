"""Prepare a generated (Tripo) model for the city: cap triangles, shrink textures, Draco GLB.

    blender --background --python tools/blender/prepare_catalog_asset.py -- \
        <input.glb> <output.glb> <max_triangles> [max_texture_px]

Thousands of homes are instanced at once, so every catalogue model has a
triangle budget (homes ~2k, towers ~4k, landmarks ~10k). Scale and pivot are
normalised at runtime (footprint fit, base on the ground), so only geometry and
texture weight are handled here. The source file is never modified.
"""

import math
import sys

import bpy


def parse_args() -> tuple[str, str, int, int]:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) < 3:
        raise SystemExit("usage: -- <input.glb> <output.glb> <max_triangles> [max_texture_px]")
    max_tris = int(argv[2])
    max_px = int(argv[3]) if len(argv) > 3 else 1024
    if max_tris < 100 or not 64 <= max_px <= 4096:
        raise SystemExit("max_triangles must be >= 100 and max_texture_px within 64..4096")
    return argv[0], argv[1], max_tris, max_px


def triangle_count(objects) -> int:
    total = 0
    for obj in objects:
        for poly in obj.data.polygons:
            total += max(1, len(poly.vertices) - 2)
    return total


def main() -> None:
    source, target, max_tris, max_px = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=source)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit(f"{source}: no mesh found")

    before = triangle_count(meshes)
    if before > max_tris:
        ratio = max_tris / before
        for obj in meshes:
            modifier = obj.modifiers.new("budget", "DECIMATE")
            modifier.ratio = ratio
            modifier.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=modifier.name)

    for image in bpy.data.images:
        if image.size[0] > max_px or image.size[1] > max_px:
            scale = max_px / max(image.size[0], image.size[1])
            image.scale(max(1, math.floor(image.size[0] * scale)), max(1, math.floor(image.size[1] * scale)))

    after = triangle_count(meshes)
    bpy.ops.export_scene.gltf(
        filepath=target,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_image_format="WEBP",
    )
    print(f"prepared {target}: {before} -> {after} triangles, textures <= {max_px}px")


if __name__ == "__main__":
    main()
