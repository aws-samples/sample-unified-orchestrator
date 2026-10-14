#!/usr/bin/env python3
"""
List all assessments for an application with component counts
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

    s3_bucket = os.getenv('S3_UNO_DP_BUCKET')
    if not s3_bucket:
        print("Error: S3_UNO_DP_BUCKET environment variable not set")
        return 1

    print("=" * 80)
    print(f"ALL ASSESSMENTS FOR APPLICATION {application_id}")
    print("=" * 80)
    print()

    # Initialize S3 client using Config
    s3 = Config.get_boto3_client('s3')

    prefix = f"risk-assessments/{application_id}/"

    try:
        response = s3.list_objects_v2(Bucket=s3_bucket, Prefix=prefix)

        if 'Contents' not in response:
            print(f"No assessments found")
            return 1

        files = []
        for obj in response['Contents']:
            key = obj['Key']
            if key.endswith('.json'):
                files.append({
                    'key': key,
                    'last_modified': obj['LastModified'],
                    'size': obj['Size']
                })

        files.sort(key=lambda x: x['last_modified'], reverse=True)

        print(f"Found {len(files)} assessments\n")

        # Download and show component counts
        assessments = []
        for i, file_info in enumerate(files, 1):
            try:
                obj = s3.get_object(Bucket=s3_bucket, Key=file_info['key'])
                data = json.loads(obj['Body'].read().decode('utf-8'))

                component_count = data.get('executive_summary', {}).get('total_components', 0)
                assessment_date = datetime.fromtimestamp(data.get('assessment_date', 0))

                assessments.append({
                    'index': i,
                    'date': file_info['last_modified'],
                    'assessment_date': assessment_date,
                    'components': component_count,
                    'key': file_info['key'],
                    'size': file_info['size']
                })
            except Exception as e:
                print(f"Error reading {file_info['key']}: {e}")

        # Display table
        print(f"{'#':<4} {'Date':<20} {'Components':<12} {'Size':<10}")
        print("-" * 80)

        for assessment in assessments:
            date_str = assessment['date'].strftime('%Y-%m-%d %H:%M:%S')
            size_kb = assessment['size'] / 1024
            print(f"{assessment['index']:<4} {date_str:<20} {assessment['components']:<12} {size_kb:>8.1f} KB")

        print()

        # Show component count changes
        print("=" * 80)
        print("COMPONENT COUNT CHANGES")
        print("=" * 80)
        print()

        for i in range(len(assessments) - 1):
            current = assessments[i]
            previous = assessments[i + 1]

            diff = current['components'] - previous['components']

            if diff != 0:
                date_str = current['date'].strftime('%Y-%m-%d %H:%M')
                if diff < 0:
                    print(f"{date_str}: {previous['components']} → {current['components']} ({diff} components, {abs(diff)/previous['components']*100:.1f}% decrease)")
                else:
                    print(f"{date_str}: {previous['components']} → {current['components']} (+{diff} components, {diff/previous['components']*100:.1f}% increase)")

        print()

        # Find the biggest decrease
        max_decrease = 0
        max_decrease_pair = None

        for i in range(len(assessments) - 1):
            current = assessments[i]
            previous = assessments[i + 1]
            diff = previous['components'] - current['components']

            if diff > max_decrease:
                max_decrease = diff
                max_decrease_pair = (previous, current)

        if max_decrease_pair:
            prev, curr = max_decrease_pair
            print("=" * 80)
            print("BIGGEST COMPONENT DECREASE")
            print("=" * 80)
            print()
            print(f"From: {prev['date'].strftime('%Y-%m-%d %H:%M:%S')} ({prev['components']} components)")
            print(f"To:   {curr['date'].strftime('%Y-%m-%d %H:%M:%S')} ({curr['components']} components)")
            print(f"Decrease: {max_decrease} components ({max_decrease/prev['components']*100:.1f}%)")
            print()
            print("This likely shows the impact of noise filtering!")

        return 0

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == '__main__':
    sys.exit(main())
