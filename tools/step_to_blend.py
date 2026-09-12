#!/usr/bin/env python3
"""STEP -> .blend + QA PNG via Blender.

Pipeline: STEP-in -> tessellate + cleanup -> 3 cameras + 3 lights ->
Eevee defaults -> QA PNG + .blend out.

Two modes, one file:
  * Outside Blender (normal): parses args, then re-execs itself under
    ``blender --background --python <this file> -- <args>``.
  * Inside Blender: does the actual scene work (imports bpy lazily so the
    CLI side stays dependency-free and ``py_compile``-clean anywhere).

STEP import backends, probed in order (builds differ on STEP support):
  1. Blender-native STEP operator (``bpy.ops.wm.step_import``), if present.
  2. FreeCAD CLI (``freecadcmd``, overridable via --freecad) converting
     STEP -> STL into a temp dir, then ``bpy.ops.wm.stl_import``.
Otherwise it exits with an actionable error instead of a traceback.

No hard-coded paths: --out-blend / --qa-png default to siblings of STEP-in.

Examples:
  python3 tools/step_to_blend.py assets/garage/bracket.step
  python3 tools/step_to_blend.py part.stp --qa-cam closeup --eevee-samples 64
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

DEFAULT_RESOLUTION = (1280, 800)  # matches ELP OV9281 sensor aspect
CAM_NAMES = ("CAM_OVERHEAD", "CAM_CLOSEUP", "CAM_PERSP")


# ---------------------------------------------------------------- CLI side

def build_parser():
    p = argparse.ArgumentParser(
        description="Convert STEP to .blend with cameras, lights, "
                    "Eevee defaults, and a QA render.")
    p.add_argument("step_in", help="input STEP file (.step/.stp)")
    p.add_argument("--out-blend", default=None,
                   help="output .blend (default: <step stem>.blend next to input)")
    p.add_argument("--qa-png", default=None,
                   help="output QA render (default: <step stem>_qa.png next to input)")
    p.add_argument("--blender", default="blender",
                   help="Blender binary (default: %(default)s)")
    p.add_argument("--freecad", default="freecadcmd",
                   help="FreeCAD CLI for STEP->STL fallback (default: %(default)s)")
    p.add_argument("--deflection", type=float, default=0.1,
                   help="tessellation/cleanup tolerance in mm (default: %(default)s)")
    p.add_argument("--eevee-samples", type=int, default=32,
                   help="Eevee render samples (default: %(default)s)")
    p.add_argument("--resolution", type=int, nargs=2, default=list(DEFAULT_RESOLUTION),
                   metavar=("W", "H"),
                   help="QA render size (default: %(default)s)")
    p.add_argument("--qa-cam", choices=("overhead", "closeup", "persp"),
                   default="persp", help="which camera renders the QA PNG")
    p.add_argument("--no-render", action="store_true",
                   help="skip the QA PNG render (still writes .blend)")
    return p


def derive_defaults(ns):
    """Fill in out-blend / QA paths from the STEP-in location. No hard-coding."""
    stem, _ = os.path.splitext(os.path.abspath(ns.step_in))
    if not ns.out_blend:
        ns.out_blend = stem + ".blend"
    if not ns.qa_png:
        ns.qa_png = stem + "_qa.png"
    ns.out_blend = os.path.abspath(ns.out_blend)
    ns.qa_png = os.path.abspath(ns.qa_png)
    return ns


def build_blender_cmd(ns, script_path):
    """Re-exec argv for ``blender --background --python this -- args``."""
    inner = [ns.step_in, "--out-blend", ns.out_blend, "--qa-png", ns.qa_png,
             "--freecad", ns.freecad, "--deflection", str(ns.deflection),
             "--eevee-samples", str(ns.eevee_samples),
             "--resolution", str(ns.resolution[0]), str(ns.resolution[1]),
             "--qa-cam", ns.qa_cam]
    if ns.no_render:
        inner.append("--no-render")
    return [ns.blender, "--background", "--python", script_path,
            "--"] + inner


def main(argv=None):
    ns = build_parser().parse_args(argv)
    if _inside_blender():
        return _blender_main(ns)
    # CLI side: validate early, then hand off to Blender.
    ns = derive_defaults(ns)
    if not os.path.isfile(ns.step_in):
        print("step_to_blend: STEP not found: %s" % ns.step_in, file=sys.stderr)
        return 2
    if shutil.which(ns.blender) is None:
        print("step_to_blend: blender binary not found: %s" % ns.blender,
              file=sys.stderr)
        return 2
    cmd = build_blender_cmd(ns, os.path.abspath(__file__))
    print("step_to_blend: %s" % " ".join(cmd))
    return subprocess.call(cmd)


def _inside_blender():
    try:
        import bpy  # noqa: F401
        return True
    except ImportError:
        return False


# ---------------------------------------------------------- Blender side
# Everything below imports bpy/bmesh lazily so plain python3 never needs them.

def _blender_main(ns):
    import bpy
    ns = derive_defaults(ns)
    _reset_scene(bpy)
    n_tris = _import_and_cleanup(bpy, ns)
    center, radius = _frame_selection(bpy)
    _add_cameras(bpy, center, radius)
    _add_lights(bpy, center, radius)
    _eevee_defaults(bpy, ns)
    bpy.ops.wm.save_as_mainfile(filepath=ns.out_blend)
    rendered = None
    if not ns.no_render:
        _set_active_cam(bpy, ns.qa_cam)
        bpy.context.scene.render.filepath = ns.qa_png
        bpy.ops.render.render(write_still=True)
        rendered = ns.qa_png
    print("step_to_blend: tris=%d center=%s radius=%.1fmm blend=%s qa=%s"
          % (n_tris, [round(c, 1) for c in center], radius,
             ns.out_blend, rendered or "(skipped)"))
    return 0


def _reset_scene(bpy):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def _import_and_cleanup(bpy, ns):
    imported = _import_step(bpy, ns)
    if not imported:
        raise RuntimeError("STEP import produced no mesh objects: %s" % ns.step_in)
    return _cleanup_meshes(bpy, ns.deflection)


def _import_step(bpy, ns):
    """Tessellate STEP via the first available backend. Returns mesh objects."""
    before = set(bpy.context.scene.objects)
    op = getattr(bpy.ops.wm, "step_import", None)
    if op is not None:
        try:
            op(filepath=ns.step_in)
        except Exception as e:  # operator exists but refused (schema/units/...)
            print("step_to_blend: native STEP import failed: %s" % e)
        else:
            got = _new_meshes(bpy, before)
            if got:
                return got
    stl = _freecad_to_stl(ns)
    if stl is not None:
        bpy.ops.wm.stl_import(filepath=stl)
        return _new_meshes(bpy, before)
    raise RuntimeError(
        "no STEP backend: this Blender has no bpy.ops.wm.step_import and "
        "FreeCAD CLI (%r) is missing or failed. Install FreeCAD (provides "
        "freecadcmd) or pass --freecad <path>; see script docstring."
        % ns.freecad)


def _new_meshes(bpy, before):
    return [o for o in bpy.context.scene.objects
            if o not in before and o.type == "MESH"]


def _freecad_to_stl(ns):
    """Convert STEP->STL with freecadcmd. Returns STL path or None."""
    if shutil.which(ns.freecad) is None:
        print("step_to_blend: no FreeCAD CLI at %r, skipping" % ns.freecad)
        return None
    tmp = tempfile.mkdtemp(prefix="step_to_blend_")
    stl = os.path.join(tmp, "part.stl")
    conv = os.path.join(tmp, "convert.py")
    with open(conv, "w") as f:
        f.write(
            "import sys\n"
            "import FreeCAD, Part, Mesh\n"
            "src, dst = sys.argv[-2], sys.argv[-1]\n"
            "shape = Part.read(src)\n"
            "doc = FreeCAD.newDocument('conv')\n"
            "feat = doc.addObject('Part::Feature', 'src')\n"
            "feat.Shape = shape\n"
            "doc.recompute()\n"
            "Mesh.export([feat], dst)\n")
    r = subprocess.call([ns.freecad, conv, "--", ns.step_in, stl])
    if r != 0 or not os.path.isfile(stl):
        print("step_to_blend: freecadcmd conversion failed (rc=%d)" % r)
        return None
    return stl


def _cleanup_meshes(bpy, tolerance):
    """Merge doubles, recalc normals, smooth shade. Returns total tris."""
    import bmesh
    total = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=max(tolerance, 1e-4))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        for poly in mesh.polygons:
            poly.use_smooth = True
        total += sum(len(p.vertices) - 2 for p in mesh.polygons)
    return total


def _frame_selection(bpy):
    from mathutils import Vector
    pts = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        pts.extend([obj.matrix_world @ Vector(c) for c in obj.bound_box])
    if not pts:
        raise RuntimeError("nothing to frame: no mesh objects in scene")
    lo = Vector((min(p[i] for p in pts) for i in range(3)))
    hi = Vector((max(p[i] for p in pts) for i in range(3)))
    center = (lo + hi) / 2.0
    radius = max((hi - lo).length / 2.0, 1.0)
    return tuple(center), radius


def _look_at(obj, target):
    from mathutils import Vector
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def _add_cameras(bpy, center, radius):
    cx, cy, cz = center
    defs = {
        "CAM_OVERHEAD": (cx, cy + radius * 3.0, cz + radius * 0.02),
        "CAM_CLOSEUP": (cx + radius * 1.2, cy + radius * 0.7, cz + radius * 1.6),
        "CAM_PERSP": (cx + radius * 2.2, cy + radius * 1.6, cz + radius * 2.6),
    }
    for name, loc in defs.items():
        cam = bpy.data.cameras.new(name)
        obj = bpy.data.objects.new(name, cam)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = loc
        _look_at(obj, center)
    return defs


def _set_active_cam(bpy, which):
    name = {"overhead": "CAM_OVERHEAD", "closeup": "CAM_CLOSEUP",
            "persp": "CAM_PERSP"}[which]
    bpy.context.scene.camera = bpy.data.objects[name]


def _add_lights(bpy, center, radius):
    cx, cy, cz = center
    key = bpy.data.lights.new("KEY", "SUN")
    key.energy = 3.0
    o = bpy.data.objects.new("KEY", key)
    bpy.context.scene.collection.objects.link(o)
    o.location = (cx + radius * 2, cy + radius * 3, cz + radius)
    fill = bpy.data.lights.new("FILL", "AREA")
    fill.energy = 250.0 * radius * radius / 100.0
    fill.size = radius
    o = bpy.data.objects.new("FILL", fill)
    bpy.context.scene.collection.objects.link(o)
    o.location = (cx - radius * 2.5, cy + radius, cz + radius * 2)
    _look_at(o, center)
    rim = bpy.data.lights.new("RIM", "AREA")
    rim.energy = 400.0 * radius * radius / 100.0
    rim.size = radius * 0.6
    o = bpy.data.objects.new("RIM", rim)
    bpy.context.scene.collection.objects.link(o)
    o.location = (cx, cy + radius * 1.5, cz - radius * 2.5)
    _look_at(o, center)


def _eevee_defaults(bpy, ns):
    scene = bpy.context.scene
    engine_ids = [e.identifier for e in
                  bpy.types.Scene.bl_rna.properties["render"].fixed_type
                  .bl_rna.properties["engine"].enum_items]
    for cand in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if cand in engine_ids:
            scene.render.engine = cand
            break
    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        for attr, val in (("taa_render_samples", ns.eevee_samples),
                          ("use_gtao", True)):
            if hasattr(eevee, attr):
                setattr(eevee, attr, val)
    scene.render.resolution_x = int(ns.resolution[0])
    scene.render.resolution_y = int(ns.resolution[1])
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"


if __name__ == "__main__":
    # Blender passes only args after "--" into sys.argv for --python scripts.
    args = sys.argv
    if "--" in args:
        args = args[args.index("--") + 1:]
    else:
        args = args[1:]
    sys.exit(main(args))
