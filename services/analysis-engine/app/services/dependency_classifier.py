"""
Dependency Classifier Service

Classifies dependencies by type based on keyword matching.
Supports multiple categories and language-specific package names.

Ported as-is from replatform-analyzer.
"""

import logging
import re
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class DependencyClassifier:
    """
    Service for classifying dependencies by type

    Features:
    - Keyword-based classification
    - Multiple categories (Database, Middleware, Framework, etc.)
    - Language-specific package names
    - Fuzzy matching for variations
    - Default to "Library" when no match
    """

    # Classification keywords by category
    CLASSIFICATION_KEYWORDS = {
        'Database': [
            'mysql', 'postgresql', 'postgres', 'oracle', 'sqlserver', 'mssql',
            'mongodb', 'mongo', 'redis', 'cassandra', 'couchbase', 'dynamodb',
            'mariadb', 'sqlite', 'h2', 'derby', 'hsqldb', 'neo4j',
            'elasticsearch', 'elastic', 'solr', 'influxdb'
        ],
        'Middleware': [
            'kafka', 'rabbitmq', 'activemq', 'artemis', 'jms',
            'mq', 'message', 'queue', 'broker'
        ],
        'Framework': [
            'spring', 'django', 'flask', 'express', 'fastapi',
            'dotnet', 'aspnet', 'asp.net', 'entityframework',
            'hibernate', 'mybatis', 'jpa', 'struts', 'jsf',
            'angular', 'react', 'vue', 'blazor'
        ],
        'Web Server': [
            'tomcat', 'jetty', 'undertow', 'netty', 'nginx',
            'apache', 'iis', 'kestrel', 'gunicorn', 'uvicorn',
            'weblogic', 'websphere', 'jboss', 'wildfly'
        ],
        'ORM': [
            'hibernate', 'mybatis', 'jpa', 'entityframework',
            'dapper', 'nhibernate', 'sqlalchemy', 'django-orm',
            'sequelize', 'typeorm', 'prisma'
        ],
        'Testing': [
            'junit', 'testng', 'mockito', 'pytest', 'unittest',
            'nose', 'xunit', 'nunit', 'mstest', 'mocha',
            'jest', 'jasmine', 'karma', 'selenium', 'cucumber'
        ],
        'Logging': [
            'log4j', 'logback', 'slf4j', 'logging', 'serilog',
            'nlog', 'log4net', 'winston', 'bunyan'
        ],
        'Security': [
            'spring-security', 'shiro', 'oauth', 'jwt', 'saml',
            'authentication', 'authorization', 'identity'
        ],
        'HTTP Client': [
            'httpclient', 'okhttp', 'retrofit', 'requests',
            'axios', 'fetch', 'restsharp', 'flurl'
        ],
        'JSON': [
            'jackson', 'gson', 'json', 'newtonsoft', 'system.text.json'
        ],
        'XML': [
            'jaxb', 'dom4j', 'xstream', 'system.xml'
        ]
    }

    def __init__(self):
        """Initialize Dependency Classifier"""
        logger.info("Dependency Classifier initialized")

    def classify(self, package_name: str, ecosystem: Optional[str] = None) -> str:
        """
        Classify a dependency by type.

        Args:
            package_name: Name of the package/dependency
            ecosystem: Optional ecosystem (Java, Python, .NET) for context

        Returns:
            Classification category string
        """
        if not package_name:
            return 'Library'

        # Normalize package name for matching
        normalized_name = package_name.lower().replace('_', '-').replace('.', '-')

        # Check each category
        for category, keywords in self.CLASSIFICATION_KEYWORDS.items():
            for keyword in keywords:
                if self._matches(normalized_name, keyword):
                    logger.debug(f"Classified '{package_name}' as '{category}' (matched: {keyword})")
                    return category

        # Default classification
        return 'Library'

    def _matches(self, package_name: str, keyword: str) -> bool:
        """
        Check if package name matches keyword.

        Uses fuzzy matching to handle variations:
        - Exact match
        - Contains keyword
        - Starts with keyword
        - Word boundary match
        """
        keyword = keyword.lower()

        # Exact match
        if package_name == keyword:
            return True

        # Contains keyword as whole word
        pattern = r'\b' + re.escape(keyword) + r'\b'
        if re.search(pattern, package_name):
            return True

        # Starts with keyword
        if package_name.startswith(keyword):
            return True

        # Contains keyword (less strict)
        if keyword in package_name:
            # Avoid false positives for very short keywords
            if len(keyword) >= 4:
                return True

        return False

    def classify_batch(self, dependencies: List[Dict]) -> List[Dict]:
        """
        Classify a batch of dependencies.

        Args:
            dependencies: List of dependency dictionaries

        Returns:
            List of dependencies with 'classification' field added
        """
        for dep in dependencies:
            package_name = dep.get('package_name') or dep.get('name') or dep.get('artifact_id')
            ecosystem = dep.get('ecosystem')

            if package_name:
                dep['classification'] = self.classify(package_name, ecosystem)
            else:
                dep['classification'] = 'Unknown'

        return dependencies

    def get_categories(self) -> List[str]:
        """Get list of all classification categories"""
        return list(self.CLASSIFICATION_KEYWORDS.keys()) + ['Library', 'Unknown']

    def get_keywords_for_category(self, category: str) -> List[str]:
        """Get keywords for a specific category"""
        return self.CLASSIFICATION_KEYWORDS.get(category, [])
