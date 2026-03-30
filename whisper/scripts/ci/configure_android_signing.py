from __future__ import annotations

import re
import sys
from pathlib import Path


IMPORT_BLOCK = """import java.io.FileInputStream
import java.util.Properties

"""

HELPER_BLOCK = """// BEGIN CI SIGNING CONFIG
def signingProperties = new Properties()
def signingPropertiesFile = rootProject.file("signing/key.properties")
if (signingPropertiesFile.exists()) {
    signingProperties.load(new FileInputStream(signingPropertiesFile))
}
def hasDebugSigning = [
    "DEBUG_STORE_FILE",
    "DEBUG_STORE_PASSWORD",
    "DEBUG_KEY_ALIAS",
    "DEBUG_KEY_PASSWORD",
].every { signingProperties.getProperty(it) }
def hasReleaseSigning = [
    "RELEASE_STORE_FILE",
    "RELEASE_STORE_PASSWORD",
    "RELEASE_KEY_ALIAS",
    "RELEASE_KEY_PASSWORD",
].every { signingProperties.getProperty(it) }
// END CI SIGNING CONFIG

"""

SIGNING_CONFIGS_BLOCK = """    signingConfigs {
        debug {
            if (hasDebugSigning) {
                storeFile rootProject.file(signingProperties.getProperty("DEBUG_STORE_FILE"))
                storePassword signingProperties.getProperty("DEBUG_STORE_PASSWORD")
                keyAlias signingProperties.getProperty("DEBUG_KEY_ALIAS")
                keyPassword signingProperties.getProperty("DEBUG_KEY_PASSWORD")
            } else {
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
        release {
            if (hasReleaseSigning) {
                storeFile rootProject.file(signingProperties.getProperty("RELEASE_STORE_FILE"))
                storePassword signingProperties.getProperty("RELEASE_STORE_PASSWORD")
                keyAlias signingProperties.getProperty("RELEASE_KEY_ALIAS")
                keyPassword signingProperties.getProperty("RELEASE_KEY_PASSWORD")
            }
        }
    }
"""


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: configure_android_signing.py <android-app-build.gradle>")

    path = Path(sys.argv[1])
    if not path.is_file():
        fail(f"file not found: {path}")

    text = path.read_text(encoding="utf-8")

    if "import java.io.FileInputStream" not in text:
        text = IMPORT_BLOCK + text

    if "// BEGIN CI SIGNING CONFIG" not in text:
        text, helper_count = re.subn(
            r"(def jscFlavor = [^\n]+\n\n)",
            r"\1" + HELPER_BLOCK,
            text,
            count=1,
        )
        if helper_count != 1:
            fail("could not insert signing helper block into build.gradle")

    text, signing_count = re.subn(
        r"    signingConfigs \{.*?^    \}\n(?=    buildTypes \{)",
        SIGNING_CONFIGS_BLOCK,
        text,
        count=1,
        flags=re.MULTILINE | re.DOTALL,
    )
    if signing_count != 1:
        fail("could not replace signingConfigs block in build.gradle")

    text, debug_count = re.subn(
        r"(        debug \{\n)\s*signingConfig .*?\n",
        r"\1            signingConfig signingConfigs.debug\n",
        text,
        count=1,
    )
    if debug_count != 1:
        fail("could not normalize debug signingConfig line in build.gradle")

    text, release_count = re.subn(
        r"(        release \{\n(?:            //.*\n)*)\s*signingConfig .*?\n",
        r"\1            signingConfig hasReleaseSigning ? signingConfigs.release : signingConfigs.debug\n",
        text,
        count=1,
    )
    if release_count != 1:
        fail("could not normalize release signingConfig line in build.gradle")

    path.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
