"""
Transformation Pattern Analyzer Service

Analyzes transformation patterns across all applications in a wave.
Ported from replatform-analyzer, adapted for PAM/Snowflake data on DynamoDB.

Two approaches:
  A) Component-level: pam_data.components[] exists (granular, preferred)
  B) Metadata-level: only top-level pam_data/snowflake_data fields (fallback)
"""
import re
import logging
from typing import Dict, List, Any, Optional
from collections import defaultdict

logger = logging.getLogger(__name__)


class TransformationAnalyzer:
    """Analyzes transformation patterns across wave applications."""

    def aggregate_wave_transformations(self, wave_id, applications):
        """Main entry: aggregate patterns from all apps in a wave."""
        logger.info(f"Aggregating transformations for {wave_id} ({len(applications)} apps)")
        if not applications:
            return self._empty_result(wave_id, "No applications found")
        tmap = {}
        assessed = 0
        pending = 0
        warnings = []
        for app in applications:
            app_id = app.get("app_id") or app.get("application_id") or "unknown"
            pam = app.get("pam_data") or {}
            snow = app.get("snowflake_data") or {}
            comps = pam.get("components") or []
            if comps:
                assessed += 1
                try:
                    self._extract_from_components(comps, app_id, tmap)
                except Exception as e:
                    logger.warning(f"Component parse error {app_id}: {e}")
                    warnings.append(f"Failed to process {app_id}: {str(e)}")
            elif pam or snow:
                assessed += 1
                try:
                    self._extract_from_metadata(pam, snow, app_id, tmap)
                except Exception as e:
                    logger.warning(f"Metadata parse error {app_id}: {e}")
                    warnings.append(f"Failed to process {app_id}: {str(e)}")
            else:
                pending += 1
        transformations = self._finalize(tmap)
        stats = self._calc_stats(transformations, len(applications), assessed, pending)
        result = {
            "success": True,
            "wave_id": wave_id,
            "transformations": transformations,
            "statistics": stats,
            "transformation_types": self._type_dist(transformations),
            "complexity_distribution": self._complexity_dist(transformations),
        }
        if warnings:
            result["warnings"] = warnings
            result["warnings_count"] = len(warnings)
        return result

    # -- Approach A: component-level ------------------------------------

    def _extract_from_components(self, comps, app_id, tmap):
        for c in comps:
            try:
                self._process_component(c, app_id, tmap)
            except Exception as e:
                logger.warning(f"Skip component {c.get('product','?')} for {app_id}: {e}")

    def _process_component(self, c, app_id, tmap):
        pub = c.get("software_publisher", "Unknown")
        prod = c.get("product", "Unknown")
        src_v = c.get("full_version", "Unknown")
        cat = c.get("category_group", "Unknown")
        sub = c.get("sub_category", "")
        machine = c.get("computer_name", "")
        if self.is_programming_language(sub):
            return
        if prod == "Unknown" or src_v == "Unknown":
            return
        tv = c.get("target_version")
        if isinstance(tv, dict) and tv:
            tgt_v = tv.get("version", "Not Found")
            tgt_p = tv.get("product_key", prod)
        elif tv and not isinstance(tv, dict):
            tgt_v = str(tv)
            tgt_p = prod
        else:
            tgt_v = "Not Found"
            tgt_p = prod
        key = f"{pub}|{prod}|{src_v}|{tgt_v}"
        if key not in tmap:
            tt = self.categorize_transformation(src_v, tgt_v, prod, tgt_p)
            cx = self.calculate_complexity(tt, src_v, tgt_v)
            tmap[key] = {
                "source": {"publisher": pub, "product": prod, "version": src_v, "category": cat},
                "target": {"publisher": pub, "product": tgt_p, "version": tgt_v, "category": cat},
                "type": tt, "complexity": cx,
                "components": set(), "machines": set(), "applications": set(),
            }
        tmap[key]["components"].add(f"{pub}|{prod}|{src_v}")
        if machine:
            tmap[key]["machines"].add(machine)
        tmap[key]["applications"].add(app_id)

    # -- Approach B: metadata-level fallback ----------------------------

    def _extract_from_metadata(self, pam, snow, app_id, tmap):
        pairs = [
            (pam.get("operating_system", ""), pam.get("target_os", ""), "Operating Systems"),
            (pam.get("database_type", ""), pam.get("target_database", ""), "Databases"),
            (pam.get("middleware", ""), pam.get("target_middleware", ""), "Middleware"),
            (pam.get("runtime_version", ""), pam.get("target_runtime", ""), "Runtime Environments"),
            (snow.get("framework_version", ""), snow.get("target_framework_version", ""), "Frameworks"),
        ]
        for src, tgt, cat in pairs:
            if not src or not src.strip():
                continue
            tgt = tgt or "Not Found"
            pub = "Unknown"
            parts = src.split()
            prod = parts[0] if parts else "Unknown"
            key = f"{pub}|{prod}|{src}|{tgt}"
            if key not in tmap:
                tt = self.categorize_transformation(src, tgt, prod, prod)
                cx = self.calculate_complexity(tt, src, tgt)
                tmap[key] = {
                    "source": {"publisher": pub, "product": prod, "version": src, "category": cat},
                    "target": {"publisher": pub, "product": prod, "version": tgt, "category": cat},
                    "type": tt, "complexity": cx,
                    "components": set(), "machines": set(), "applications": set(),
                }
            tmap[key]["components"].add(f"{pub}|{prod}|{src}")
            tmap[key]["applications"].add(app_id)

    # -- Pure logic: categorize / complexity ----------------------------

    def categorize_transformation(self, src_ver, tgt_ver, src_prod, tgt_prod):
        """Returns: UPGRADE, MODERNIZE, NO_CHANGE, or GENERIC_MIGRATE"""
        if tgt_ver == "Not Found":
            return "GENERIC_MIGRATE"
        if src_ver == tgt_ver:
            return "NO_CHANGE"
        modernize_pairs = [
            ("solaris", "rhel"), ("solaris", "red hat"), ("solaris", "linux"),
            ("aix", "rhel"), ("aix", "red hat"), ("aix", "linux"),
            ("hp-ux", "rhel"), ("hp-ux", "red hat"), ("hp-ux", "linux"),
        ]
        sl, tl = src_prod.lower(), tgt_prod.lower()
        for sp, tp in modernize_pairs:
            if sp in sl and tp in tl:
                return "MODERNIZE"
        if src_prod != tgt_prod:
            sw = set(src_prod.lower().split())
            tw = set(tgt_prod.lower().split())
            if len(sw & tw) < len(sw) * 0.5:
                return "MODERNIZE"
        return "UPGRADE"

    def calculate_complexity(self, t_type, src_ver, tgt_ver):
        """Returns: CRITICAL, HIGH, MEDIUM, or LOW"""
        if tgt_ver == "Not Found" or t_type == "GENERIC_MIGRATE":
            return "CRITICAL"
        if t_type == "MODERNIZE":
            return "HIGH"
        if t_type == "NO_CHANGE":
            return "LOW"
        try:
            sm = self.extract_major_version(src_ver)
            tm = self.extract_major_version(tgt_ver)
            if sm and tm:
                jump = abs(int(tm) - int(sm))
                return "MEDIUM" if jump >= 2 else "LOW"
        except (ValueError, TypeError):
            pass
        return "MEDIUM"

    # -- Utility methods ------------------------------------------------

    @staticmethod
    def extract_major_version(ver):
        m = re.search(r"(\d+)", ver)
        return m.group(1) if m else None

    @staticmethod
    def is_programming_language(sub_category):
        if not sub_category:
            return False
        s = sub_category.lower()
        return "programming" in s and "language" in s

    def generate_pattern_id(self, src_prod, src_ver, tgt_prod, tgt_ver, p_type):
        def _n(name):
            return re.sub(r"[^a-zA-Z0-9\s]", "", name).replace(" ", "_").upper()
        sm = self.extract_major_version(src_ver) or src_ver
        if p_type == "GENERIC_MIGRATE" or tgt_ver == "Not Found":
            return f"{_n(src_prod)}_{sm}_GENERIC_MIGRATE"
        tm = self.extract_major_version(tgt_ver) or tgt_ver
        if p_type == "NO_CHANGE":
            return f"{_n(src_prod)}_{sm}_NO_CHANGE"
        return f"{_n(src_prod)}_{sm}_TO_{_n(tgt_prod)}_{tm}_{p_type}"

    # -- Finalization / statistics / filtering --------------------------

    def _finalize(self, tmap):
        result = []
        for td in tmap.values():
            tid = self.generate_pattern_id(
                td["source"]["product"], td["source"]["version"],
                td["target"]["product"], td["target"]["version"], td["type"],
            )
            result.append({
                "transformation_id": tid,
                "type": td["type"],
                "complexity": td["complexity"],
                "component_count": len(td["components"]),
                "machine_count": len(td["machines"]),
                "application_count": len(td["applications"]),
                "description": self._desc(td),
                "source": td["source"],
                "target": td["target"],
                "manual_review_required": td["target"]["version"] == "Not Found",
            })
        result.sort(key=lambda x: x["component_count"], reverse=True)
        return result

    @staticmethod
    def _desc(td):
        s, t, tt = td["source"], td["target"], td["type"]
        if t["version"] == "Not Found":
            return f"{s['product']} {s['version']} - Manual review required (No approved target version found)"
        if tt == "NO_CHANGE":
            return f"{s['product']} {s['version']} - No migration required"
        return f"{s['product']} {s['version']} to {t['product']} {t['version']}"

    @staticmethod
    def _calc_stats(transformations, total, assessed, pending):
        return {
            "total_unique_patterns": len(transformations),
            "total_component_migrations": sum(t["component_count"] for t in transformations),
            "high_complexity_count": sum(1 for t in transformations if t["complexity"] == "HIGH"),
            "critical_complexity_count": sum(1 for t in transformations if t["complexity"] == "CRITICAL"),
            "manual_review_required": sum(1 for t in transformations if t.get("manual_review_required")),
            "total_applications": total,
            "assessed_applications": assessed,
            "pending_assessments": pending,
        }

    @staticmethod
    def _type_dist(transformations):
        d = defaultdict(int)
        for t in transformations:
            d[t["type"]] += 1
        return dict(d)

    @staticmethod
    def _complexity_dist(transformations):
        d = defaultdict(int)
        for t in transformations:
            d[t["complexity"]] += 1
        return dict(d)

    @staticmethod
    def filter_by_type(patterns, types):
        return [p for p in patterns if p.get("type") in types] if types else patterns

    @staticmethod
    def filter_by_complexity(patterns, levels):
        return [p for p in patterns if p.get("complexity") in levels] if levels else patterns

    @staticmethod
    def search_patterns(patterns, term):
        if not term:
            return patterns
        low = term.lower().strip()
        return [p for p in patterns if low in p.get("transformation_id", "").lower() or low in p.get("description", "").lower()]

    @classmethod
    def apply_filters(cls, patterns, types=None, complexity_levels=None, search_term=None):
        f = patterns
        if types:
            f = cls.filter_by_type(f, types)
        if complexity_levels:
            f = cls.filter_by_complexity(f, complexity_levels)
        if search_term:
            f = cls.search_patterns(f, search_term)
        return f

    @staticmethod
    def _empty_result(wave_id, msg):
        return {
            "success": False, "error": msg, "wave_id": wave_id,
            "transformations": [], "statistics": {},
            "transformation_types": {}, "complexity_distribution": {},
        }
