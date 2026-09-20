#!/usr/bin/env python3
"""Offline contract checks for the public template; not a Quantumult X emulator.

Run: python3 scripts/validate-profile.py [public-template.conf]
Regex samples use Python's engine and synthetic names, never real subscriptions.
"""

from collections import Counter
from pathlib import Path
import re
import sys
import unittest


PROFILE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "profiles/QuanX-Roaming.conf"
sys.argv[1:] = []
TEXT = PROFILE.read_text(encoding="utf-8")
SECTIONS = {}
SECTION_NAMES = []
section = None
for number, line in enumerate(TEXT.splitlines(), 1):
    line = line.strip()
    if not line or line.startswith(("#", ";", "//")):
        continue
    if line.startswith("[") and line.endswith("]"):
        section = line
        SECTION_NAMES.append(section)
        SECTIONS.setdefault(section, [])
    elif section:
        SECTIONS[section].append((number, line))

POLICIES = {}
POLICY_NAMES = []
for number, line in SECTIONS.get("[policy]", []):
    kind, body = line.split("=", 1)
    fields = [field.strip() for field in body.split(",")]
    name = fields.pop(0)
    POLICY_NAMES.append(name)
    options = dict(field.split("=", 1) for field in fields if "=" in field)
    candidates = [field for field in fields if "=" not in field]
    POLICIES[name] = (kind.strip(), candidates, options)

REGIONS = {
    "香港节点": ("香港 01", "HK 01", "hk-02", "Hong Kong 03", "🇭🇰 04", "港01"),
    "台湾节点": ("台湾 01", "TW 01", "Taiwan 02", "臺灣 03", "🇹🇼 04", "台01"),
    "日本节点": ("日本 01", "JP 01", "jp-02", "Japan 03", "🇯🇵 04", "日01", "日本 01 | No.1", "JP 01 | NO.1"),
    "新加坡节点": ("新加坡 01", "SG 01", "Singapore 02", "🇸🇬 03", "狮01"),
    "韩国节点": ("韩国 01", "KR 01", "Seoul 02", "Korea 03", "🇰🇷 04", "韓01"),
    "美国节点": ("美国 01", "US 01", "USA 02", "United States 03", "🇺🇸 04", "美01"),
    "欧洲节点": ("德国 01", "DE 01", "UK 02", "France 03", "🇬🇧 04", "🇩🇪 05", "NO 01", "no-02"),
    "其他节点": ("AUS 01", "RUS 01", "澳大利亚 01", "Canada 02", "🇨🇦 03"),
}
BUILTINS = {"direct", "proxy", "reject", "reject-tinygif", "reject-200", "reject-dict"}
APPLE_INTELLIGENCE_HOSTS = {
    "apple-relay.cloudflare.com",
    "apple-relay.fastly-edge.com",
    "cp4.cloudflare.com",
    "apple-relay.apple.com",
}
APPLE_BLOCK_START = "# BEGIN Apple智能精准分流"
APPLE_BLOCK_END = "# END Apple智能精准分流"


class ProfileContract(unittest.TestCase):
    def pattern(self, name):
        try:
            return re.compile(POLICIES[name][2]["server-tag-regex"])
        except re.error:
            self.fail("node regex is outside this offline checker's supported subset; this is not a QX syntax verdict")

    def test_unique_sections_and_groups(self):
        self.assertTrue(all(n == 1 for n in Counter(SECTION_NAMES).values()), "duplicate section")
        self.assertTrue(all(n == 1 for n in Counter(POLICY_NAMES).values()), "duplicate policy")

    def test_references_exist_and_have_no_cycles(self):
        edges = {}
        for name, (_, candidates, _) in POLICIES.items():
            self.assertTrue(all(c in POLICIES or c in BUILTINS for c in candidates), "undefined policy candidate")
            edges[name] = [c for c in candidates if c in POLICIES]
        for _, line in SECTIONS.get("[filter_remote]", []):
            match = re.search(r"(?:^|,)\s*force-policy=([^,]+)", line)
            if match:
                self.assertTrue(match[1].strip() in POLICIES or match[1].strip() in BUILTINS, "undefined force-policy")
        for _, line in SECTIONS.get("[filter_local]", []):
            fields = [p.strip() for p in line.split(",")]
            target = fields[1] if fields[0] == "final" else fields[2]
            self.assertTrue(target in POLICIES or target in BUILTINS, "undefined local policy")

        def visit(name, ancestors):
            self.assertTrue(name not in ancestors, "policy cycle")
            for child in edges[name]:
                visit(child, ancestors | {name})

        for name in edges:
            visit(name, set())

    def test_stable_defaults_do_not_select_by_latency(self):
        self.assertEqual(POLICIES["AI"][1][0], "日本节点")
        self.assertEqual(POLICIES["【CN】中国策略"][1][0], "自动选择")
        for name in (*REGIONS, "自动选择"):
            with self.subTest(group=name):
                kind, candidates, options = POLICIES[name]
                self.assertEqual(kind, "available")
                self.assertFalse(candidates, "automatic groups must filter actual nodes, not nest policies")
                self.assertTrue("server-tag-regex" in options)
                self.assertFalse({"check-interval", "tolerance", "alive-checking"} & options.keys())

    def test_manual_selection_and_latency_are_explicit_options(self):
        self.assertIn("手动固定", POLICIES, "missing direct node selector")
        self.assertEqual(POLICIES["手动固定"][0], "static")
        self.assertTrue("server-tag-regex" in POLICIES["手动固定"][2])
        self.assertIn("低延迟优先", POLICIES, "missing optional latency mode")
        self.assertEqual(POLICIES["低延迟优先"][0], "url-latency-benchmark")
        for group in ("AI", "Google", "YouTube", "Telegram", "Netflix", "【CN】中国策略"):
            self.assertIn("手动固定", POLICIES[group][1])
        self.assertIn("低延迟优先", POLICIES["【CN】中国策略"][1])

    def test_region_names_match_only_the_intended_group(self):
        patterns = {group: self.pattern(group) for group in REGIONS}
        for expected, samples in REGIONS.items():
            for sample in samples:
                for group in REGIONS:
                    with self.subTest(sample=sample, group=group):
                        self.assertEqual(bool(patterns[group].search(sample)), group == expected)

    def test_info_and_mainland_labels_do_not_enter_node_pools(self):
        for group, (_, _, options) in POLICIES.items():
            if "server-tag-regex" not in options:
                continue
            pattern = self.pattern(group)
            for sample in ("JP 剩余 20GB", "US 到期 2027", "HK Traffic 10GB", "JP used 10GB", "JP Total 100GB", "US Notice", "JP Renew", "SG Quota", "DE Bandwidth", "CN 01", "CN01", "CHN01", "China 02", "中国 03", "🇨🇳 04", ""):
                with self.subTest(group=group, sample=sample):
                    self.assertFalse(pattern.search(sample))
        for name in ("自动选择", "低延迟优先", "手动固定"):
            self.assertIn(name, POLICIES)
            self.assertTrue(re.search(POLICIES[name][2]["server-tag-regex"], "JP CN2 01"), "CN2 transport label is not mainland location")

    def test_youtube_resource_precedes_broad_google_resource(self):
        tags = []
        for _, line in SECTIONS["[filter_remote]"]:
            match = re.search(r"(?:^|,)\s*tag=([^,]+)", line)
            if match and "enabled=false" not in line:
                tags.append(match[1])
        self.assertLess(tags.index("YouTube"), tags.index("Google"))
        self.assertIn("Google Voice", tags, "existing Voice resource must remain enabled")
        self.assertLess(tags.index("Google Voice"), tags.index("Google"))

    def test_known_voice_entrypoints_have_an_explicit_us_route(self):
        local = [line for _, line in SECTIONS["[filter_local]"]]
        for host in ("voice.google.com", "voice.telephony.goog"):
            self.assertIn(f"host, {host}, 美国节点", local)
        for _, line in SECTIONS["[filter_remote]"]:
            if "ddgksf2013/Filter/master/GoogleVoice.list" in line:
                self.assertIn("enabled=true", line, "preserve the existing Voice resource; limited coverage does not prove it is wrong")

    def test_apple_intelligence_reuses_existing_choices(self):
        self.assertTrue("Apple智能" in POLICIES, "missing Apple Intelligence selector")
        kind, candidates, options = POLICIES["Apple智能"]
        self.assertEqual(kind, "static", "Apple Intelligence must not introduce automatic exit changes")
        self.assertEqual(candidates, ["AI", "苹果服务"], "default follows AI; Apple services is a manual alternative")
        self.assertFalse({"server-tag-regex", "resource-tag-regex"} & options.keys(), "reuse existing policies instead of adding another node pool")
        self.assertEqual(POLICIES["苹果服务"][1][0], "direct")

    def test_apple_intelligence_scope_is_exact_and_local(self):
        rules = [tuple(part.strip() for part in line.split(",")) for _, line in SECTIONS["[filter_local]"]]
        apple_rules = [rule for rule in rules if len(rule) >= 3 and rule[2] == "Apple智能"]
        expected = [("host", host, "Apple智能") for host in APPLE_INTELLIGENCE_HOSTS]
        self.assertCountEqual(apple_rules, expected, "only the four reviewed exact hosts may use Apple Intelligence")
        for _, line in SECTIONS.get("[filter_remote]", []):
            for field in line.split(",")[1:]:
                key, separator, value = field.partition("=")
                if separator and key.strip() == "force-policy":
                    self.assertNotEqual(value.strip(), "Apple智能", "a remote list must not silently expand the reviewed local scope")

    def test_apple_intelligence_can_be_removed_as_one_rule_block(self):
        self.assertEqual(TEXT.count(APPLE_BLOCK_START), 1, "missing or duplicate Apple rollback block start")
        self.assertEqual(TEXT.count(APPLE_BLOCK_END), 1, "missing or duplicate Apple rollback block end")
        start = TEXT.index(APPLE_BLOCK_START)
        end = TEXT.index(APPLE_BLOCK_END)
        self.assertLess(start, end)
        self.assertGreater(start, TEXT.index("[filter_local]"))
        self.assertLess(end, TEXT.index("[mitm]"))
        block = TEXT[start:end]
        rules = [tuple(part.strip() for part in line.split(",")) for line in block.splitlines()
                 if line.strip() and not line.lstrip().startswith(("#", ";", "//"))]
        expected = [("host", host, "Apple智能") for host in APPLE_INTELLIGENCE_HOSTS]
        self.assertCountEqual(rules, expected, "rollback block must contain all Apple hosts and no unrelated rules")

    def test_environment_and_finance_defaults_are_preserved(self):
        self.assertEqual(POLICIES["【HK】香港策略"][1][0], "direct")
        self.assertEqual(POLICIES["金融支付"][1][0], "direct")
        self.assertEqual(POLICIES["兜底分流"][1][0], "环境模式")
        for group in ("Google", "YouTube", "Telegram", "Netflix", "TikTok", "Instagram", "Twitter"):
            self.assertEqual(POLICIES[group][1][0], "环境模式")
        local = [line for _, line in SECTIONS["[filter_local]"]]
        self.assertEqual(local[-1], "final, 兜底分流")
        broad = local.index("host-keyword, github, proxy")
        for domain in ("alipay.com", "tenpay.com", "unionpay.com", "12306.cn", "icbc.com.cn", "cmbchina.com", "pingan.com.cn", "cpic.com.cn"):
            self.assertLess(local.index(f"host-suffix, {domain}, 金融支付"), broad)

    def test_public_template_has_no_nodes_or_certificates(self):
        self.assertFalse(SECTIONS.get("[server_local]"), "public template contains server entries")
        self.assertFalse(SECTIONS.get("[server_remote]"), "public template contains subscriptions")
        for _, line in SECTIONS.get("[mitm]", []):
            self.assertFalse(re.match(r"(?:passphrase|p12)\s*=\s*\S", line), "public template contains certificate data")


if __name__ == "__main__":
    unittest.main(verbosity=2)
