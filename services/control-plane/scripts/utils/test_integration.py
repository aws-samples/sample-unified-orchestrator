#!/usr/bin/env python3
"""
Test the integrated noise filtering workflow
"""

import sys
import os

# Add backend to path so we can import Config
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

from dotenv import load_dotenv
load_dotenv()

from app.config import Config

def main():
    # Initialize DynamoDB resource using Config
    dynamodb = Config.get_boto3_resource('dynamodb')

    print("=" * 80)
    print("TESTING INTEGRATED NOISE FILTERING")
    print("=" * 80)
    print()

    # Check tables exist
    tables_to_check = [
        Config.APP_COMPONENTS_TABLE,
        Config.APP_NOISE_COMPONENTS_TABLE,
        Config.DEFAULT_OS_VERSION_TABLE
    ]

    print("Checking tables...")
    for table_name in tables_to_check:
        try:
            table = dynamodb.Table(table_name)
            table.load()
            print(f"  ✓ {table_name} exists")
        except Exception as e:
            print(f"  ✗ {table_name} does not exist: {e}")
            return 1

    print()

    # Count components in each table
    print("Counting components...")

    # App components
    app_table = dynamodb.Table(Config.APP_COMPONENTS_TABLE)
    response = app_table.scan(Select='COUNT')
    app_count = response.get('Count', 0)
    print(f"  {Config.APP_COMPONENTS_TABLE}: {app_count}")

    # Noise components
    noise_table = dynamodb.Table(Config.APP_NOISE_COMPONENTS_TABLE)
    response = noise_table.scan(Select='COUNT')
    noise_count = response.get('Count', 0)
    print(f"  {Config.APP_NOISE_COMPONENTS_TABLE}: {noise_count}")

    # Default OS components
    default_table = dynamodb.Table(Config.DEFAULT_OS_VERSION_TABLE)
    response = default_table.scan(Select='COUNT')
    default_count = response.get('Count', 0)
    print(f"  {Config.DEFAULT_OS_VERSION_TABLE}: {default_count}")

    print()

    total_components = app_count + noise_count

    if total_components > 0:
        noise_rate = noise_count / total_components * 100
        print("=" * 80)
        print("RESULTS")
        print("=" * 80)
        print()
        print(f"Total components: {total_components}")
        print(f"Clean components: {app_count}")
        print(f"Noise components: {noise_count}")
        print(f"Noise rate: {noise_rate:.1f}%")
        print()

        if noise_count > 0:
            print("✓ Noise filtering is working!")
        else:
            print("⚠ No noise components found. Either:")
            print("  1. No default OS components were uploaded")
            print("  2. No components matched default OS")
    else:
        print("⚠ No components found in either table")
        print("  Please load application data first")

    print()

    # Sample some noise components
    if noise_count > 0:
        print("=" * 80)
        print("SAMPLE NOISE COMPONENTS (first 10)")
        print("=" * 80)
        print()

        response = noise_table.scan(Limit=10)
        for i, item in enumerate(response.get('Items', []), 1):
            publisher = item.get('software_publisher', '')
            product = item.get('product', '')
            version = item.get('full_version', '')
            print(f"{i}. {publisher} / {product} (v{version})")

        print()

    print("=" * 80)

    return 0

if __name__ == '__main__':
    sys.exit(main())
