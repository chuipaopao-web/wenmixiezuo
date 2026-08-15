#!/usr/bin/env bash
sqlite3 /opt/wenmi/data/database/wenmi.sqlite "SELECT email_normalized, role, status, created_at FROM user_accounts ORDER BY created_at;"
