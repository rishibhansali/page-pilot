# conftest.py — adds the backend directory to sys.path so all test files can import backend modules.
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
