export const DB_VERSIONS = {
  sqlserver: ['2022', '2019', '2017', '2016', '2014', '2012', '2008 R2'],
  postgresql: ['16', '15', '14', '13', '12', '11', '10', '9.6'],
  mysql: ['8.0', '5.7', '5.6'],
  oracle: ['23c', '21c', '19c', '18c', '12c', '11g'],
  mongodb: ['7.0', '6.0', '5.0', '4.4', '4.2'],
  mariadb: ['11.0', '10.11', '10.6', '10.5', '10.4'],
}

export const AWS_ENGINES = {
  rds: ['sqlserver', 'postgresql', 'mysql', 'mariadb', 'oracle'],
  'rds-custom': ['sqlserver', 'oracle'],
  ec2: ['sqlserver', 'postgresql', 'mysql', 'mariadb', 'oracle', 'mongodb'],
  aurora: ['mysql', 'postgresql'],
  documentdb: ['mongodb'],
  dynamodb: ['dynamodb'],
}

export const AWS_RDS_VERSIONS: Record<string, Record<string, string[]>> = {
  sqlserver: {
    'SQL Server 2022': ['16.00.4085.2', '16.00.4075.1'],
    'SQL Server 2019': ['15.00.4335.1', '15.00.4312.2', '15.00.4280.7'],
    'SQL Server 2017': ['14.00.3451.2', '14.00.3421.10'],
    'SQL Server 2016': ['13.00.6419.1', '13.00.6300.2'],
  },
  postgresql: {
    'PostgreSQL 16': ['16.1', '16.0'],
    'PostgreSQL 15': ['15.5', '15.4', '15.3'],
    'PostgreSQL 14': ['14.10', '14.9', '14.8'],
    'PostgreSQL 13': ['13.13', '13.12'],
  },
  mysql: {
    'MySQL 8.0': ['8.0.35', '8.0.34', '8.0.33'],
    'MySQL 5.7': ['5.7.44', '5.7.42'],
  },
  oracle: {
    'Oracle 19c': ['19.0.0.0.ru-2023-10.rur-2023-10.r1'],
    'Oracle 12c': ['12.2.0.1.ru-2023-10.rur-2023-10.r1'],
  },
  mariadb: {
    'MariaDB 10.11': ['10.11.6', '10.11.5'],
    'MariaDB 10.6': ['10.6.16', '10.6.15'],
  },
}

export const DEFAULT_PORTS: Record<string, number> = {
  sqlserver: 1433,
  postgresql: 5432,
  mysql: 3306,
  oracle: 1521,
  mongodb: 27017,
  mariadb: 3306,
  dynamodb: 8000,
}

export const AWS_REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-east-2', label: 'US East (Ohio)' },
  { value: 'us-west-1', label: 'US West (N. California)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
  { value: 'ap-northeast-2', label: 'Asia Pacific (Seoul)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
  { value: 'ca-central-1', label: 'Canada (Central)' },
  { value: 'eu-central-1', label: 'Europe (Frankfurt)' },
  { value: 'eu-west-1', label: 'Europe (Ireland)' },
  { value: 'eu-west-2', label: 'Europe (London)' },
  { value: 'eu-west-3', label: 'Europe (Paris)' },
  { value: 'sa-east-1', label: 'South America (São Paulo)' },
]

export const INSTANCE_CLASSES = [
  { value: 'db.t3.micro', label: 'db.t3.micro (2 vCPU, 1 GB RAM)' },
  { value: 'db.t3.small', label: 'db.t3.small (2 vCPU, 2 GB RAM)' },
  { value: 'db.t3.medium', label: 'db.t3.medium (2 vCPU, 4 GB RAM)' },
  { value: 'db.m5.large', label: 'db.m5.large (2 vCPU, 8 GB RAM)' },
  { value: 'db.m5.xlarge', label: 'db.m5.xlarge (4 vCPU, 16 GB RAM)' },
  { value: 'db.m5.2xlarge', label: 'db.m5.2xlarge (8 vCPU, 32 GB RAM)' },
  { value: 'db.r5.large', label: 'db.r5.large (2 vCPU, 16 GB RAM)' },
  { value: 'db.r5.xlarge', label: 'db.r5.xlarge (4 vCPU, 32 GB RAM)' },
]
