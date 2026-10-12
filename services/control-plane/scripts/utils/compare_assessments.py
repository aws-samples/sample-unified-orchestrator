#!/usr/bin/env python3
"""
Compare last 2 risk assessments for an application to see impact of noise filtering
"""

import sys
import os
import json
from datetime import datetime

# Add backend to path so we can import Config
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

from dotenv import load_dotenv
load_dotenv()

from app.config import Config

def main():
    application_id = "10287"

    # Get S3 bucket name
    s3_bucket = os.getenv('S3_UNO_DP_BUCKET')
    if not s3_bucket:
        print("Error: S3_UNO_DP_BUCKET environment variable not set")
        return 1

    print("=" * 80)
    print(f"COMPARING RISK ASSESSMENTS FOR APPLICATION {application_id}")
    print("=" * 80)
    print()
    print(f"S3 Bucket: {s3_bucket}")
    print()

    # Initialize S3 client using Config
    s3 = Config.get_boto3_client('s3')

    # List all assessment files for this application
    prefix = f"risk-assessments/{application_id}/"

    try:
        response = s3.list_objects_v2(
            Bucket=s3_bucket,
            Prefix=prefix
        )

        if 'Contents' not in response:
            print(f"No assessments found for application {application_id}")
            return 1

        # Get all assessment files and sort by last modified
        files = []
        for obj in response['Contents']:
            key = obj['Key']
            if key.endswith('.json'):
                files.append({
                    'key': key,
                    'last_modified': obj['LastModified'],
                    'size': obj['Size']
                })

        # Sort by last modified (newest first)
        files.sort(key=lambda x: x['last_modified'], reverse=True)

        print(f"Found {len(files)} assessment files")
        print()

        if len(files) < 2:
            print("Need at least 2 assessments to compare")
            return 1

        # Get the last 2 assessments
        latest = files[0]
        previous = files[1]

        print("Latest assessment:")
        print(f"  File: {latest['key']}")
        print(f"  Date: {latest['last_modified']}")
        print(f"  Size: {latest['size']} bytes")
        print()

        print("Previous assessment:")
        print(f"  File: {previous['key']}")
        print(f"  Date: {previous['last_modified']}")
        print(f"  Size: {previous['size']} bytes")
        print()

        # Download and parse both assessments
        print("Downloading assessments...")

        latest_obj = s3.get_object(Bucket=s3_bucket, Key=latest['key'])
        latest_data = json.loads(latest_obj['Body'].read().decode('utf-8'))

        previous_obj = s3.get_object(Bucket=s3_bucket, Key=previous['key'])
        previous_data = json.loads(previous_obj['Body'].read().decode('utf-8'))

        print("✓ Downloaded both assessments")
        print()

        # Extract component counts from executive_summary
        latest_count = latest_data.get('executive_summary', {}).get('total_components', 0)
        previous_count = previous_data.get('executive_summary', {}).get('total_components', 0)

        # Also get other metrics
        latest_target_found = latest_data.get('executive_summary', {}).get('target_versions_found', 0)
        previous_target_found = previous_data.get('executive_summary', {}).get('target_versions_found', 0)

        latest_coverage = latest_data.get('executive_summary', {}).get('target_version_coverage', 0)
        previous_coverage = previous_data.get('executive_summary', {}).get('target_version_coverage', 0)

        print("=" * 80)
        print("COMPONENT COUNT COMPARISON")
        print("=" * 80)
        print()
        print(f"Previous assessment: {previous_count} components")
        print(f"Latest assessment:   {latest_count} components")
        print()

        difference = latest_count - previous_count
        if difference < 0:
            print(f"✓ Decreased by {abs(difference)} components ({abs(difference)/previous_count*100:.1f}%)")
            print()
            print("This indicates noise filtering is working!")
        elif difference > 0:
            print(f"⚠ Increased by {difference} components ({difference/previous_count*100:.1f}%)")
        else:
            print("No change in component count")

        print()

        # Show target version metrics
        print("=" * 80)
        print("TARGET VERSION METRICS")
        print("=" * 80)
        print()
        print("Previous assessment:")
        print(f"  Target versions found: {previous_target_found}")
        print(f"  Coverage: {previous_coverage:.1f}%")
        print()
        print("Latest assessment:")
        print(f"  Target versions found: {latest_target_found}")
        print(f"  Coverage: {latest_coverage:.1f}%")
        print()

        # Show risk distribution
        print("=" * 80)
        print("RISK DISTRIBUTION")
        print("=" * 80)
        print()

        prev_risk = previous_data.get('executive_summary', {}).get('risk_distribution', {})
        latest_risk = latest_data.get('executive_summary', {}).get('risk_distribution', {})

        print("Previous assessment:")
        for level in ['Critical', 'High', 'Medium', 'Low', 'Unknown']:
            count = prev_risk.get(level, 0)
            print(f"  {level}: {count}")

        print()
        print("Latest assessment:")
        for level in ['Critical', 'High', 'Medium', 'Low', 'Unknown']:
            count = latest_risk.get(level, 0)
            print(f"  {level}: {count}")

        print()

        # Show scores comparison
        print("=" * 80)
        print("SCORES COMPARISON")
        print("=" * 80)
        print()

        prev_scores = previous_data.get('scores', {})
        latest_scores = latest_data.get('scores', {})

        score_names = [
            'overall_readiness_score',
            'risk_score',
            'complexity_score',
            'migration_readiness_score',
            'team_readiness_score',
            'business_readiness_score'
        ]

        for score_name in score_names:
            prev_val = prev_scores.get(score_name, 0)
            latest_val = latest_scores.get(score_name, 0)
            diff = latest_val - prev_val

            label = score_name.replace('_', ' ').title()

            if diff > 0:
                print(f"{label}: {prev_val} → {latest_val} (+{diff})")
            elif diff < 0:
                print(f"{label}: {prev_val} → {latest_val} ({diff})")
            else:
                print(f"{label}: {prev_val} (no change)")

        print()
        print("=" * 80)

        return 0

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == '__main__':
    sys.exit(main())
