#!/usr/bin/env python3
"""
Inspect the structure of a risk assessment file
"""

import sys
import os
import json

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

    print(f"Inspecting assessments for application {application_id}")
    print()

    # Initialize S3 client using Config
    s3 = Config.get_boto3_client('s3')

    # List assessment files
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
                    'last_modified': obj['LastModified']
                })

        files.sort(key=lambda x: x['last_modified'], reverse=True)

        if not files:
            print("No JSON files found")
            return 1

        # Get the latest file
        latest = files[0]
        print(f"Latest file: {latest['key']}")
        print(f"Date: {latest['last_modified']}")
        print()

        # Download and inspect
        obj = s3.get_object(Bucket=s3_bucket, Key=latest['key'])
        data = json.loads(obj['Body'].read().decode('utf-8'))

        print("Top-level keys:")
        for key in data.keys():
            value = data[key]
            if isinstance(value, list):
                print(f"  {key}: list with {len(value)} items")
            elif isinstance(value, dict):
                print(f"  {key}: dict with {len(value)} keys")
            else:
                print(f"  {key}: {type(value).__name__}")

        print()

        # Look for component-related data
        if 'complexity_analysis' in data:
            comp_analysis = data['complexity_analysis']
            print("complexity_analysis keys:")
            for key in comp_analysis.keys():
                value = comp_analysis[key]
                if isinstance(value, list):
                    print(f"  {key}: list with {len(value)} items")
                elif isinstance(value, dict):
                    print(f"  {key}: dict")
                else:
                    print(f"  {key}: {value}")

            if 'total_components' in comp_analysis:
                print()
                print(f"Total components: {comp_analysis['total_components']}")

        print()

        # Show a sample of the data structure
        print("Sample data structure (first 1000 chars):")
        print(json.dumps(data, indent=2)[:1000])

        return 0

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == '__main__':
    sys.exit(main())
