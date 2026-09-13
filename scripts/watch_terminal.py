"""Execute the real workstation jobs inside the visible terminal, not a replay."""
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time

ROOT = Path('/home/user/project/.watch')
ROOT.mkdir(exist_ok=True)
print('\033]0;Atelier live work\007', end='', flush=True)
print('ATELIER / LIVE WORK\nActual commands, code and output from this computer.\n', flush=True)
(ROOT / 'ready').write_text(str(os.getpid()))

while True:
    for path in sorted(ROOT.glob('*.request.json')):
        result_path = path.with_name(path.name.replace('.request.json', '.result.json'))
        if result_path.exists():
            continue
        job = json.loads(path.read_text())
        command = job['command']
        print('\n' + '=' * 70 + '\n$ ' + command, flush=True)
        if job.get('source'):
            print('\n--- Source being executed ---\n' + job['source'] + '\n--- Live output ---', flush=True)
        process = subprocess.Popen(command, shell=True, cwd='/home/user/project',
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, start_new_session=True,
                                   env={**os.environ, 'PYTHONUNBUFFERED': '1'})
        deadline = time.monotonic() + min(int(job['timeout']), 800)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        output = ''
        timed_out = False
        while selector.get_map():
            if time.monotonic() > deadline:
                timed_out = True
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                # Stop waiting even if a detached child retained the output pipe.
                break
            for key, _ in selector.select(.2):
                data = os.read(key.fd, 4096)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                text = data.decode('utf-8', errors='replace')
                print(text, end='', flush=True)
                output = (output + text)[-12000:]
        selector.close()
        process.stdout.close()
        try:
            exit_code = process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            exit_code = process.wait()
        if timed_out:
            exit_code = 124
            output += '\nCommand reached its time allowance.'
        print('\n[Exit ' + str(exit_code) + '] Waiting for the next real action.', flush=True)
        temporary = result_path.with_suffix('.tmp')
        temporary.write_text(json.dumps({'exitCode': exit_code, 'stdout': output, 'stderr': ''}))
        temporary.replace(result_path)
    time.sleep(.15)
