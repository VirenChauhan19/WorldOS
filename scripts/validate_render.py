"""Offline Blueprint schema and $0-resource checks; never creates resources.

Install scripts/requirements-validation.txt and download the schema from
https://render.com/schema/render.yaml.json, then pass --schema <local file>.
"""
import argparse
import json
from pathlib import Path

import jsonschema
import yaml

ROOT = Path(__file__).resolve().parents[1]


def validate(schema):
    documents = {}
    validator = jsonschema.validators.validator_for(schema)(schema)
    for name in ('render.yaml', 'deploy/render.paid.yaml'):
        document = yaml.safe_load((ROOT/name).read_text(encoding='utf-8'))
        validator.validate(document)
        documents[name] = document
    free = documents['render.yaml']
    assert set(free) == {'services'} and len(free['services']) == 1, 'Free Blueprint must contain only one service.'
    service = free['services'][0]
    assert service['type'] == 'web' and service['runtime'] == 'docker' and service['plan'] == 'free'
    assert not {'disk', 'scaling', 'preDeployCommand'} & set(service), 'Free Blueprint contains incompatible resources.'
    assert service['numInstances'] == 1 and service['healthCheckPath'] == '/healthz'
    values = {entry['key']: entry for entry in service['envVars']}
    for key, value in {'WORLDOS_DEPLOYMENT':'public', 'WORLDOS_STORAGE_MODE':'ephemeral',
                       'WORLDOS_DATA_DIR':'/tmp/worldos', 'WORLDOS_BACKUPS_ENABLED':'0',
                       'WORLDOS_MAX_CONCURRENT_WRITES':'1', 'WORLDOS_MAX_REQUEST_MB':'12',
                       'WORLDOS_MAX_UPLOAD_MB':'6', 'WORLDOS_MAX_IMAGE_PIXELS':'6000000',
                       'OPENBLAS_NUM_THREADS':'1', 'OMP_NUM_THREADS':'1'}.items():
        assert values[key]['value'] == value, f'Unexpected free configuration: {key}'
    paid = documents['deploy/render.paid.yaml']['services'][0]
    assert paid['plan'] == 'standard' and paid['disk'] == {'name':'worldos-data', 'mountPath':'/var/data', 'sizeGB':5}
    paid_values = {entry['key']: entry for entry in paid['envVars']}
    assert paid_values['WORLDOS_STORAGE_MODE']['value'] == 'persistent'
    assert paid_values['WORLDOS_DATA_DIR']['value'] == '/var/data/worldos'
    for key in ('WORLDOS_AUTH_PASSWORD_HASH', 'MODEL_API_KEY', 'BASETEN_API_KEY'):
        assert values[key] == paid_values[key] == {'key':key, 'sync':False}, f'Secret must be entered only at runtime: {key}'
    for key in ('WORLDOS_SAM_PROVIDER', 'WORLDOS_MUSE_PROVIDER', 'BASETEN_MUSE_MODEL',
                'BASETEN_BASE_URL', 'WORLDOS_MUSE_MODEL', 'WORLDOS_AI_TIMEOUT_SECONDS'):
        assert values[key] == paid_values[key], f'Provider configuration changed: {key}'
    print('PASS: both Blueprints match the official schema; default has one Free web service, no disk/database, and runtime-only secrets.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--schema', type=Path, required=True)
    args = parser.parse_args()
    validate(json.loads(args.schema.read_text(encoding='utf-8')))
