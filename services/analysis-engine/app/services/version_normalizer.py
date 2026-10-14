"""
Version Normalizer Service

Normalizes version strings from different package managers to a consistent format.
Handles variable references, ranges, wildcards, and format variations.

Ported as-is from replatform-analyzer.
"""

import logging
import re
from typing import Optional, Dict

try:
    from packaging import version as pkg_version
    PACKAGING_AVAILABLE = True
except ImportError:
    PACKAGING_AVAILABLE = False
    logging.warning("packaging library not installed. Version normalization will be limited.")

logger = logging.getLogger(__name__)


class VersionNormalizer:
    """
    Service for normalizing version strings

    Features:
    - Resolve variable references
    - Handle version ranges (use minimum)
    - Handle wildcards (use base version)
    - Normalize format variations (1.0 vs 1.0.0)
    - Preserve pre-release tags
    - Flag special keywords (latest, RELEASE)
    """

    # Special version keywords that need lookup
    SPECIAL_KEYWORDS = ['latest', 'release', 'snapshot']

    def __init__(self):
        """Initialize Version Normalizer"""
        logger.info("Version Normalizer initialized")

    def normalize(self, version_str: str, variables: Optional[Dict[str, str]] = None) -> Dict[str, any]:
        """
        Normalize a version string.

        Args:
            version_str: Version string to normalize
            variables: Optional dictionary of variables for substitution

        Returns:
            Dictionary with normalized version and metadata
        """
        if not version_str:
            return {
                'normalized': None,
                'original': version_str,
                'needs_lookup': True,
                'reason': 'empty version'
            }

        original = version_str
        version_str = version_str.strip()

        # Resolve variable references
        if variables and ('$' in version_str or '{' in version_str):
            version_str = self._resolve_variables(version_str, variables)

        # Check for special keywords
        if any(keyword in version_str.lower() for keyword in self.SPECIAL_KEYWORDS):
            return {
                'normalized': None,
                'original': original,
                'needs_lookup': True,
                'reason': f'special keyword: {version_str}'
            }

        # Handle version ranges
        if self._is_range(version_str):
            normalized = self._extract_minimum_from_range(version_str)
            return {
                'normalized': normalized,
                'original': original,
                'needs_lookup': False,
                'is_range': True,
                'range_spec': version_str
            }

        # Handle wildcards
        if '*' in version_str:
            normalized = version_str.replace('*', '0')
            return {
                'normalized': normalized,
                'original': original,
                'needs_lookup': False,
                'had_wildcard': True
            }

        # Normalize format (1.0 -> 1.0.0)
        normalized = self._normalize_format(version_str)

        return {
            'normalized': normalized,
            'original': original,
            'needs_lookup': False
        }

    def _resolve_variables(self, version_str: str, variables: Dict[str, str]) -> str:
        """Resolve variable references like ${var} or $var"""
        # Handle ${variable} format
        pattern = r'\$\{([^}]+)\}'
        matches = re.findall(pattern, version_str)
        for var_name in matches:
            if var_name in variables:
                version_str = version_str.replace(f'${{{var_name}}}', variables[var_name])

        # Handle $variable format
        pattern = r'\$([a-zA-Z_][a-zA-Z0-9_]*)'
        matches = re.findall(pattern, version_str)
        for var_name in matches:
            if var_name in variables:
                version_str = version_str.replace(f'${var_name}', variables[var_name])

        return version_str

    def _is_range(self, version_str: str) -> bool:
        """Check if version string is a range"""
        # Maven/NuGet range: [1.0,2.0) or (1.0,2.0]
        if version_str.startswith('[') or version_str.startswith('('):
            return True

        # Python range: >=1.0,<2.0
        if ',' in version_str and any(op in version_str for op in ['>=', '<=', '>', '<', '==']):
            return True

        return False

    def _extract_minimum_from_range(self, version_str: str) -> Optional[str]:
        """Extract minimum version from a range specification"""
        # Maven/NuGet range: [1.0,2.0) -> 1.0
        if version_str.startswith('[') or version_str.startswith('('):
            match = re.search(r'[\[\(]([0-9\.]+)', version_str)
            if match:
                return match.group(1)

        # Python range: >=1.0,<2.0 -> 1.0
        if ',' in version_str:
            parts = version_str.split(',')
            for part in parts:
                part = part.strip()
                # Look for >= or == operators
                if '>=' in part:
                    return part.split('>=')[1].strip()
                elif '==' in part:
                    return part.split('==')[1].strip()
                elif '~=' in part:
                    return part.split('~=')[1].strip()

            # Fallback: extract first version number found
            match = re.search(r'([0-9]+\.[0-9]+(?:\.[0-9]+)?)', version_str)
            if match:
                return match.group(1)

        return None

    def _normalize_format(self, version_str: str) -> str:
        """
        Normalize version format to consistent style.

        Examples:
        - 1.0 -> 1.0.0
        - 1 -> 1.0.0
        - 1.0.0-alpha -> 1.0.0-alpha (preserve pre-release)
        """
        if not PACKAGING_AVAILABLE:
            # Simple normalization without packaging library
            return self._simple_normalize(version_str)

        try:
            # Use packaging library for proper version parsing
            parsed = pkg_version.parse(version_str)

            # Reconstruct normalized version
            base = parsed.base_version

            # Add pre-release if present
            if parsed.pre:
                pre_type, pre_num = parsed.pre
                base = f"{base}-{pre_type}{pre_num}"

            # Add post-release if present
            if parsed.post is not None:
                base = f"{base}.post{parsed.post}"

            # Add dev release if present
            if parsed.dev is not None:
                base = f"{base}.dev{parsed.dev}"

            return base

        except Exception as e:
            logger.warning(f"Failed to parse version with packaging library: {version_str} - {e}")
            return self._simple_normalize(version_str)

    def _simple_normalize(self, version_str: str) -> str:
        """Simple version normalization without packaging library"""
        # Remove leading 'v' if present
        if version_str.startswith('v'):
            version_str = version_str[1:]

        # Split into parts
        parts = version_str.split('-', 1)
        version_part = parts[0]
        pre_release = parts[1] if len(parts) > 1 else None

        # Ensure at least 3 parts (major.minor.patch)
        version_numbers = version_part.split('.')
        while len(version_numbers) < 3:
            version_numbers.append('0')

        normalized = '.'.join(version_numbers[:3])

        # Add back pre-release tag
        if pre_release:
            normalized = f"{normalized}-{pre_release}"

        return normalized
