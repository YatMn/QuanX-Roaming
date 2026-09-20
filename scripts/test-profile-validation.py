#!/usr/bin/env python3
"""Exercise the public-profile validator using disposable invalid profiles.

No real subscriptions or live Quantumult X state are read or changed.
Run: python3 scripts/test-profile-validation.py
"""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts/validate-profile.py"
PROFILE = ROOT / "profiles/QuanX-Roaming.conf"
TEXT = PROFILE.read_text(encoding="utf-8")
HOST_RULE = "host, cp4.cloudflare.com, Apple智能"
BLOCK_END = "# END Apple智能精准分流"


def replace_once(old, new):
    if TEXT.count(old) != 1:
        raise AssertionError("mutation anchor must appear exactly once")
    return TEXT.replace(old, new, 1)


class ValidatorRegression(unittest.TestCase):
    def run_validator(self, path):
        return subprocess.run(
            [sys.executable, str(VALIDATOR), str(path)],
            capture_output=True, text=True, timeout=30,
        )

    def test_current_template_passes(self):
        result = self.run_validator(PROFILE)
        self.assertEqual(result.returncode, 0, "current template must pass before testing mutations")

    def test_invalid_apple_changes_are_rejected(self):
        scope = "test_apple_intelligence_scope_is_exact_and_local"
        choices = "test_apple_intelligence_reuses_existing_choices"
        rollback = "test_apple_intelligence_can_be_removed_as_one_rule_block"
        cases = [
            ("missing-host", replace_once(HOST_RULE + "\n", ""), scope),
            ("suffix-instead-of-host", replace_once(HOST_RULE, HOST_RULE.replace("host,", "host-suffix,")), scope),
            ("broad-cloudflare", replace_once(HOST_RULE, "host-suffix, cloudflare.com, Apple智能"), scope),
            ("shared-siri", replace_once(BLOCK_END, "host, guzzoni.apple.com, Apple智能\n" + BLOCK_END), scope),
            ("duplicate-host", replace_once(HOST_RULE, HOST_RULE + "\n" + HOST_RULE), scope),
            ("wrong-target", replace_once(HOST_RULE, "host, cp4.cloudflare.com, AI"), scope),
            ("remote-expansion", replace_once("[filter_remote]", "[filter_remote]\nhttps://example.invalid/apple.list, force-policy=Apple智能, enabled=true"), scope),
            ("remote-value-whitespace", replace_once("[filter_remote]", "[filter_remote]\nhttps://example.invalid/apple.list, force-policy=Apple智能 , enabled=true"), scope),
            ("remote-key-whitespace", replace_once("[filter_remote]", "[filter_remote]\nhttps://example.invalid/apple.list, force-policy = Apple智能, enabled=true"), scope),
            ("changed-default", replace_once("static=Apple智能, AI, 苹果服务,", "static=Apple智能, 苹果服务, AI,"), choices),
            ("automatic-exit", replace_once("static=Apple智能,", "available=Apple智能,"), choices),
            ("missing-block-marker", replace_once(BLOCK_END, "# removed marker"), rollback),
            ("unrelated-rule-in-rollback", replace_once(BLOCK_END, "host, example.invalid, direct\n" + BLOCK_END), rollback),
        ]
        with tempfile.TemporaryDirectory(prefix="quanx-validator-") as directory:
            for name, text, expected_test in cases:
                with self.subTest(case=name):
                    fixture = Path(directory) / f"{name}.conf"
                    fixture.write_text(text, encoding="utf-8")
                    result = self.run_validator(fixture)
                    self.assertEqual(result.returncode, 1, "invalid fixture must fail with a contract assertion")
                    self.assertIn(f"FAIL: {expected_test} (", result.stderr, "the intended contract must reject the mutation")
                    self.assertNotIn("ERROR:", result.stderr, "a validator crash is not a successful rejection")


if __name__ == "__main__":
    unittest.main(verbosity=2)
