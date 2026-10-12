"""
Standalone Noise Filter for setup.sh

Self-contained copy of NoiseFilter and PublisherNormalizer.
Does NOT import from app/ to avoid FastAPI dependency.
"""

import logging
from typing import Dict, List, Set, Any, Tuple

logger = logging.getLogger(__name__)


class PublisherNormalizer:
    """Normalizes publisher names for semantic matching."""

    PUBLISHER_EQUIVALENTS = {
        'red hat': ['rocky', 'red hat'],
        'rocky enterprise software foundation': ['rocky', 'red hat'],
        'rocky linux': ['rocky', 'red hat'],
        'rocky': ['rocky'],
    }

    @classmethod
    def normalize(cls, publisher):
        if not publisher:
            return ''
        return publisher.lower().strip()

    @classmethod
    def get_equivalents(cls, publisher):
        normalized = cls.normalize(publisher)
        if normalized in cls.PUBLISHER_EQUIVALENTS:
            return cls.PUBLISHER_EQUIVALENTS[normalized]
        return [normalized]

    @classmethod
    def matches(cls, publisher1, publisher2):
        norm2 = cls.normalize(publisher2)
        return norm2 in cls.get_equivalents(publisher1)


class NoiseFilterService:
    """Filters app components against default OS components."""

    def __init__(self):
        self.normalizer = PublisherNormalizer()

    def filter_components(self, components, default_os_components):
        if not default_os_components:
            return components, []

        default_lookup = self._build_lookup_index(default_os_components)
        clean, noise = [], []
        for c in components:
            (noise if self._is_noise(c, default_lookup) else clean).append(c)
        print(f"Noise filter: {len(clean)} clean, {len(noise)} noise out of {len(components)} total")
        return clean, noise

    def _build_lookup_index(self, default_components):
        lookup = {}
        for comp in default_components:
            product = comp.get('product', '')
            publisher = comp.get('software_publisher', '') or comp.get('publisher', '')
            if not product:
                continue
            norm_product = product.lower().strip()
            norm_publisher = self.normalizer.normalize(publisher)
            if norm_product not in lookup:
                lookup[norm_product] = set()
            lookup[norm_product].add(norm_publisher)
        return lookup

    def _is_noise(self, component, default_lookup):
        product = component.get('product', '')
        publisher = component.get('software_publisher', '') or component.get('publisher', '')
        if not product:
            return False
        norm_product = product.lower().strip()
        if norm_product not in default_lookup:
            return False
        for equiv in self.normalizer.get_equivalents(publisher):
            if equiv in default_lookup[norm_product]:
                return True
        return False
