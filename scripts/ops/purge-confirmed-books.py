"""R165: preview/rehearse/apply a confirmed book-only purge. Never deletes accounts.

Run on the server. Preview and rehearsal are required before --mode apply.
The signed scope is bound to book IDs and row/file fingerprints, not a wildcard.
All author content and backup copies stay on the server.
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import shutil
import sqlite3
import time


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), default=str)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def q(value):
    return '"' + value.replace('"', '""') + '"'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


KEEP = {'backup_files', 'deletion_tombstones', 'account_usage_purge_archive'}
PROTECTED = {'user_accounts', 'user_memberships', 'owners', 'membership_transactions'}


def schema(c):
    tables = [r[0] for r in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")]
    return {t: [r[1] for r in c.execute('pragma table_info(' + q(t) + ')')] for t in tables}


def working(c, cols):
    found = {}
    for t, names in cols.items():
        if t in KEEP:
            continue
        state = 'state' if 'state' in names else 'status' if 'status' in names else None
        if not state or not any(x in t for x in ['task', 'model_call', '_run', '_job', 'design_call', 'cover_design']):
            continue
        if t == 'task_phases':
            # Historical phases can retain 'working' after their parent stopped.
            # Parent state, lease, and actual model calls are checked separately.
            continue
        n = c.execute('select count(*) from ' + q(t) + ' where ' + q(state) + " in ('working','running','queued','pending','in_progress','started')").fetchone()[0]
        if n:
            found[t] = n
    assert not found, ('active work; wait without cancelling', found)
    assert not c.execute("select 1 from tasks where lease_expires_at > ? limit 1", (now(),)).fetchone(), 'live task lease'


def linked_json(value, ids):
    if isinstance(value, str):
        return value in ids
    if isinstance(value, dict):
        return any(linked_json(v, ids) for v in value.values())
    if isinstance(value, list):
        return any(linked_json(v, ids) for v in value)
    return False


def plan(c, data):
    cols = schema(c)
    working(c, cols)
    books = list(c.execute('select owner_id,book_id from books order by owner_id,book_id'))
    assert len(books) == 44, ('confirmed scope changed', len(books))
    ids = {r[1] for r in books}
    selected = {}
    marks = ','.join('?' for _ in ids)
    for t, names in cols.items():
        if t in KEEP:
            continue
        refs = [n for n in names if n == 'book_id' or n.endswith('_book_id')]
        if refs:
            where = ' or '.join(q(n) + ' in (' + marks + ')' for n in refs)
            selected[t] = {r[0] for r in c.execute('select rowid from ' + q(t) + ' where ' + where, list(ids) * len(refs))}
    # Only opening drafts/tasks explicitly referring to an existing selected book.
    for t, column in [('opening_drafts', 'payload'), ('v7_opening_agent_tasks', 'state_json')]:
        for rowid, raw in c.execute('select rowid,' + q(column) + ' from ' + q(t)):
            if raw and linked_json(json.loads(raw), ids):
                selected.setdefault(t, set()).add(rowid)
    # Follow real foreign-key children, including tables without book_id.
    for _ in range(len(cols)):
        changed = False
        for t in cols:
            if t in KEEP:
                continue
            groups = {}
            for fk in c.execute('pragma foreign_key_list(' + q(t) + ')'):
                groups.setdefault(fk[0], []).append(fk)
            for group in groups.values():
                parent = group[0][2]
                if not selected.get(parent):
                    continue
                assert all(fk[4] for fk in group), ('implicit primary key not supported', t)
                join = ' and '.join('a.' + q(fk[3]) + '=b.' + q(fk[4]) for fk in group)
                rowids = sorted(selected[parent])
                # Keep SQLite parameter count bounded for large context tables.
                for start in range(0, len(rowids), 400):
                    batch = rowids[start:start + 400]
                    query = 'select a.rowid from ' + q(t) + ' a join ' + q(parent) + ' b on ' + join + ' where b.rowid in (' + ','.join('?' for _ in batch) + ')'
                    new = {r[0] for r in c.execute(query, batch)} - selected.get(t, set())
                    if new:
                        assert t not in PROTECTED, ('protected account dependency', t)
                        selected.setdefault(t, set()).update(new)
                        changed = True
        if not changed:
            break
    else:
        raise RuntimeError('dependency closure did not converge')
    selected = {t: sorted(v) for t, v in selected.items() if v}
    assert not (PROTECTED & selected.keys())
    fingerprints = {}
    for t, rowids in selected.items():
        fingerprints[t] = digest([tuple(r) for r in c.execute('select rowid,* from ' + q(t) + ' order by rowid') if r[0] in set(rowids)])
    paths = []
    for book_id in sorted(ids):
        p = data / 'books' / book_id
        assert p.resolve().parent == (data / 'books').resolve() and not p.is_symlink()
        if p.exists():
            for f in sorted(p.rglob('*')):
                assert not f.is_symlink(), ('symlink refused', str(f))
                if f.is_file():
                    paths.append([str(f.relative_to(data)), f.stat().st_size, file_hash(f)])
    for rel, size, expected_hash in c.execute('select relative_path,size_bytes,content_hash from file_registry'):
        p = data / rel
        assert p.resolve().is_relative_to((data / 'books').resolve())
        assert p.parts[len(data.parts) + 1] in ids
        assert p.is_file() and not p.is_symlink() and p.stat().st_size == size and file_hash(p) == expected_hash
    report = {'books': books, 'rows': selected, 'fingerprints': fingerprints, 'files': paths}
    return report, cols


def table_hash(c, t):
    return digest(sorted([canonical(tuple(r)) for r in c.execute('select * from ' + q(t))]))


def usage(c):
    return {(r[0], r[1]): tuple(r) for r in c.execute('select * from account_usage_projection')}


def apply_migration(c, migration):
    sql = migration.read_text(encoding='utf-8')
    checksum = hashlib.sha256(sql.encode()).hexdigest()
    existing = c.execute('select checksum from schema_migrations where name=?', (migration.name,)).fetchone()
    if existing:
        assert existing[0] == checksum
        return
    statement = ''
    for line in sql.splitlines(True):
        statement += line
        if sqlite3.complete_statement(statement):
            c.execute(statement)
            statement = ''
    assert not statement.strip()
    c.execute('insert into schema_migrations values (?,?,?)', (migration.name, checksum, now()))


def purge(c, preview, cols, backup, migration, operation):
    protected = {t: table_hash(c, t) for t in cols if t not in preview['rows'] and t not in {'backups', 'clean_cutover_operations', 'clean_cutover_delete_guard', 'schema_migrations'} and not t.startswith(('content_fts_', 'content_chunks_fts_'))}
    before_usage = usage(c)
    apply_migration(c, migration)
    backup_id = 'r165-' + backup.name
    db_hash = file_hash(backup / 'wenmi.sqlite')
    assert c.execute('pragma integrity_check').fetchone()[0] == 'ok'
    release = c.execute('select release_id from release_runs order by created_at desc limit 1').fetchone()[0]
    c.execute('insert into backups (backup_id,release_id,status,backup_path,database_hash,manifest_hash,file_count,created_at,verified_at,verification_json) values (?,?,?,?,?,?,?,?,?,?)',
              (backup_id, release, 'verified', str(backup), db_hash, file_hash(backup / 'checksums.sha256'), len(preview['files']), now(), now(), canonical({'r165': 'verified marker/checksums/database/files'})))
    manifest = canonical({'previewId': digest(preview), 'books': preview['books'], 'files': preview['files']})
    c.execute("insert into clean_cutover_operations(operation_id,preview_id,backup_id,backup_database_hash,first_confirmation_hash,second_confirmation_hash,file_manifest_json,file_manifest_hash,status,created_at) values(?,?,?,?,?,?,?,?,'prepared',?)",
              (operation, digest(preview), backup_id, db_hash, hashlib.sha256(b'YES').hexdigest(), hashlib.sha256('确认删除书籍'.encode()).hexdigest(), manifest, hashlib.sha256(manifest.encode()).hexdigest(), now()))
    c.execute('insert into clean_cutover_delete_guard values(1,?,?,?)', (operation, digest([operation, backup_id]), now()))
    c.execute('pragma defer_foreign_keys=on')
    for owner, book in preview['books']:
        title = c.execute('select title from books where book_id=?', (book,)).fetchone()[0]
        c.execute('insert into deletion_tombstones values(?,?,?,?,?,?,?)', ('r165-' + book, owner, book, title, operation + ':' + book, hashlib.sha256(b'YES').hexdigest(), now()))
    for t, rowids in preview['rows'].items():
        for start in range(0, len(rowids), 400):
            batch = rowids[start:start + 400]
            c.execute('delete from ' + q(t) + ' where rowid in (' + ','.join('?' for _ in batch) + ')', batch)
    after_usage = usage(c)
    assert all(before_usage[k] == v for k, v in after_usage.items()), 'unrelated usage changed'
    archived = [row for key, row in before_usage.items() if key not in after_usage]
    for row in archived:
        c.execute('insert into account_usage_purge_archive values (' + ','.join('?' for _ in range(19)) + ')', (*row, operation, now()))
    assert usage(c) == before_usage, 'account usage/remaining balance changed'
    for t, expected in protected.items():
        if t != 'deletion_tombstones':
            assert table_hash(c, t) == expected, ('unrelated table changed', t)
    assert c.execute('select count(*) from books').fetchone()[0] == 0
    assert c.execute('pragma foreign_key_check').fetchall() == []
    assert c.execute('pragma integrity_check').fetchone()[0] == 'ok'
    c.execute('delete from clean_cutover_delete_guard where operation_id=?', (operation,))
    c.execute("update clean_cutover_operations set status='database_cleared',deleted_books=?,deleted_rows=?,database_cleared_at=? where operation_id=?", (44, sum(map(len, preview['rows'].values())), now(), operation))
    return {'booksDeleted': 44, 'rowsDeleted': sum(map(len, preview['rows'].values())), 'tablesAffected': len(preview['rows']), 'usageRecordsPreserved': len(archived), 'allUnrelatedTablesUnchanged': True, 'usageUnchanged': True, 'integrity': 'ok', 'foreignKeyViolations': 0}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--mode', choices=['preview', 'rehearse', 'apply'], required=True)
    p.add_argument('--data', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--backup', required=True)
    p.add_argument('--migration', required=True)
    p.add_argument('--first-confirmation')
    p.add_argument('--second-confirmation')
    a = p.parse_args()
    data, out, backup, migration = map(lambda s: pathlib.Path(s).resolve(), [a.data, a.output, a.backup, a.migration])
    assert data == pathlib.Path('/opt/wenmi/data')
    assert out.is_relative_to(pathlib.Path('/opt/wenmi-releases'))
    assert backup.is_relative_to(data / 'backups/daily') and (backup / '.complete').is_file()
    out.mkdir(mode=0o700, parents=True, exist_ok=True)
    for line in (backup / 'checksums.sha256').read_text().splitlines():
        expected, rel = line.split(maxsplit=1)
        f = (backup / rel.lstrip('*')).resolve()
        assert f.is_relative_to(backup) and file_hash(f) == expected
    c = sqlite3.connect('file:' + str(data / 'database/wenmi.sqlite') + '?mode=ro', uri=True, timeout=20)
    if a.mode == 'apply':
        assert a.first_confirmation == 'YES' and a.second_confirmation == '确认删除书籍'
        # Consecutive idle observations; never cancel or pause a user's work.
        for n in range(7):
            working(c, schema(c))
            if n < 6:
                time.sleep(5)
        c.close()
        c = sqlite3.connect(str(data / 'database/wenmi.sqlite'), timeout=20)
    elif a.mode == 'rehearse':
        rehearsal = out / 'rehearsal.sqlite'
        assert not rehearsal.exists(), 'use a fresh rehearsal path'
        target = sqlite3.connect(str(rehearsal))
        c.backup(target)
        c.close()
        c = target
    c.execute('pragma foreign_keys=on')
    c.execute('begin immediate' if a.mode != 'preview' else 'begin')
    try:
        preview, cols = plan(c, data)
        if a.mode == 'preview':
            (out / 'preview.json').write_text(canonical(preview), encoding='utf-8')
            c.rollback()
            print(canonical({'mode': 'preview', 'books': len(preview['books']), 'tables': len(preview['rows']), 'rows': sum(map(len, preview['rows'].values())), 'files': len(preview['files']), 'previewHash': digest(preview)}))
            return
        expected = json.loads((out / 'preview.json').read_text())
        assert digest(preview) == digest(expected), 'scope/data/files changed since preview'
        if a.mode == 'apply':
            proof = json.loads((out / 'rehearsal-passed.json').read_text())
            assert proof['previewHash'] == digest(preview) and proof['scriptHash'] == file_hash(pathlib.Path(__file__)) and proof['migrationHash'] == file_hash(migration)
        operation = 'r165-books-' + digest(preview)[:20]
        report = purge(c, preview, cols, backup, migration, operation)
        report.update({'mode': a.mode, 'previewHash': digest(preview), 'scriptHash': file_hash(pathlib.Path(__file__)), 'migrationHash': file_hash(migration), 'operation': operation, 'time': now()})
        c.commit()
        if a.mode == 'apply':
            (out / 'database-cleared.json').write_text(canonical(report))
            for _, book in preview['books']:
                target = data / 'books' / book
                assert target.resolve().parent == (data / 'books').resolve() and not target.is_symlink()
                if target.exists():
                    assert not any(f.is_symlink() for f in target.rglob('*'))
                    shutil.rmtree(target)
            assert all(not (data / rel).exists() for rel, _, _ in preview['files'])
            c.execute("update clean_cutover_operations set status='completed',file_cleanup_json=?,completed_at=? where operation_id=?", (canonical({'filesRemoved': len(preview['files'])}), now(), operation))
            c.commit()
            report['filesRemoved'] = len(preview['files'])
        (out / ('completed.json' if a.mode == 'apply' else 'rehearsal-passed.json')).write_text(canonical(report))
        print(canonical(report))
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


if __name__ == '__main__':
    main()
