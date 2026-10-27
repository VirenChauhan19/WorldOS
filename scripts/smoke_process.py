"""Stop only the process tree created by an HTTP smoke harness."""
import os
import subprocess


def stop_server(process):
    if process.poll() is not None:
        return
    if os.name == 'nt':
        # Windows venv python.exe can launch a child interpreter. Terminating
        # only its launcher leaves the API and SQLite file handles alive.
        stopped=subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False)
        if stopped.returncode and process.poll() is None:
            raise RuntimeError('The owned smoke server could not be stopped.')
    else:
        process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill();process.wait(timeout=5)
