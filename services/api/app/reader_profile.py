from .models import ReaderProfile, ReaderProfilePatch
from .storage import iter_settings, set_settings


DISPLAY_NAME_KEY = "reader.display_name"


def get_reader_profile() -> ReaderProfile:
    values = dict(iter_settings([DISPLAY_NAME_KEY]))
    return ReaderProfile(display_name=values.get(DISPLAY_NAME_KEY, ""))


def update_reader_profile(patch: ReaderProfilePatch) -> ReaderProfile:
    # This label is local UI preference only; it is never a companion memory.
    set_settings({DISPLAY_NAME_KEY: patch.display_name.strip() or None})
    return get_reader_profile()
