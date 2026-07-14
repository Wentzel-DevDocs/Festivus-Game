"""Create the durable academy startup map from the compiled native world director.

Run from the repository root with UnrealEditor-Cmd and the PythonScript
commandlet. The script is intentionally idempotent: an existing map is loaded
and normalized instead of duplicated.
"""

import unreal


MAP_PATH = "/Game/Maps/AcademyAtrium"
DIRECTOR_CLASS_PATH = "/Script/FestivusAcademy.AcademyWorldDirector"


level_editor = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actor_editor = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

if unreal.EditorAssetLibrary.does_asset_exist(MAP_PATH):
    if not level_editor.load_level(MAP_PATH):
        raise RuntimeError(f"Could not load existing academy map: {MAP_PATH}")
else:
    if not level_editor.new_level(MAP_PATH):
        raise RuntimeError(f"Could not create academy map: {MAP_PATH}")

director_class = unreal.load_class(None, DIRECTOR_CLASS_PATH)
if director_class is None:
    raise RuntimeError(f"Could not load native world director: {DIRECTOR_CLASS_PATH}")

actors = actor_editor.get_all_level_actors()
existing_directors = [
    actor
    for actor in actors
    if actor.get_class() == director_class
]

if not existing_directors:
    director = actor_editor.spawn_actor_from_class(
        director_class,
        unreal.Vector(0.0, 0.0, 0.0),
        unreal.Rotator(0.0, 0.0, 0.0),
        transient=False,
    )
    if director is None:
        raise RuntimeError("Could not place AcademyWorldDirector in the startup map")
    director.set_actor_label("Academy World Director")
elif len(existing_directors) > 1:
    for duplicate in existing_directors[1:]:
        actor_editor.destroy_actor(duplicate)

if not level_editor.save_current_level():
    raise RuntimeError(f"Could not save academy map: {MAP_PATH}")

final_count = sum(
    1
    for actor in actor_editor.get_all_level_actors()
    if actor.get_class() == director_class
)
if final_count != 1:
    raise RuntimeError(f"Expected one AcademyWorldDirector, found {final_count}")

unreal.log(f"Festivus Academy authoring complete: {MAP_PATH} with one world director")
