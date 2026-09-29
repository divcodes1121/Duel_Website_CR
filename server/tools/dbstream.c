/*
 * dbstream — write a consistent image of a live SQLite database to stdout,
 * page by page, without ever holding a second full copy on disk.
 *
 * WHY. `db_backup.py` first copied the bot's database to a temp file with the
 * online backup API and compressed that. The copy needs free space equal to
 * the database, and at a full ten-month window the database is ~260 GB on a
 * 387 GB disk — two of them do not fit. Streaming needs only the compressed
 * output (~1/6 of the size).
 *
 * HOW. One read transaction (in WAL mode the writer carries on), then
 *     1. `PRAGMA quick_check` (or `integrity_check` with --full) — on the SAME
 *        snapshot the dump is about to read, because it is the same
 *        transaction; its result goes to stderr as `check: ok`;
 *     2. `SELECT data FROM sqlite_dbpage ORDER BY pgno` — every page as this
 *        transaction sees it (WAL frames included), written raw to stdout.
 * Concatenated pages ARE a database file, so `zstd -d` of the output restores
 * one directly. It exits non-zero if the check is not "ok" or a page is short,
 * and prints `pages: N  page_size: M` last so the caller can size-check.
 *
 * BUILD (sqlite_dbpage is not in Ubuntu's libsqlite3, so it is built from the
 * official amalgamation, whose SHA3-256 db_backup's installer notes):
 *   gcc -O2 -DSQLITE_ENABLE_DBPAGE_VTAB -DSQLITE_THREADSAFE=0 \
 *       -o dbstream dbstream.c sqlite3.c -lm
 *
 * USAGE:  dbstream [--full] /path/to/db.sqlite | zstd -3 -T4 -o out.db.zst
 */
#include <stdio.h>
#include <string.h>
#include "sqlite3.h"

static int fail(sqlite3 *db, const char *what) {
    fprintf(stderr, "dbstream: %s: %s\n", what, db ? sqlite3_errmsg(db) : "?");
    if (db) sqlite3_close(db);
    return 2;
}

int main(int argc, char **argv) {
    int full = 0;
    const char *path = NULL;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--full") == 0) full = 1;
        else path = argv[i];
    }
    if (!path) { fprintf(stderr, "usage: dbstream [--full] DB\n"); return 64; }

    sqlite3 *db = NULL;
    if (sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, NULL) != SQLITE_OK)
        return fail(db, "open");
    sqlite3_busy_timeout(db, 60000);
    if (sqlite3_exec(db, "BEGIN", NULL, NULL, NULL) != SQLITE_OK) return fail(db, "begin");

    /* Pin the snapshot: a read transaction starts at its first read. */
    sqlite3_stmt *st = NULL;
    int page_size = 0, page_count = 0;
    if (sqlite3_prepare_v2(db, "PRAGMA page_size", -1, &st, NULL) != SQLITE_OK) return fail(db, "page_size");
    if (sqlite3_step(st) == SQLITE_ROW) page_size = sqlite3_column_int(st, 0);
    sqlite3_finalize(st);
    if (sqlite3_prepare_v2(db, "PRAGMA page_count", -1, &st, NULL) != SQLITE_OK) return fail(db, "page_count");
    if (sqlite3_step(st) == SQLITE_ROW) page_count = sqlite3_column_int(st, 0);
    sqlite3_finalize(st);

    const char *check_sql = full ? "PRAGMA integrity_check(20)" : "PRAGMA quick_check(20)";
    if (sqlite3_prepare_v2(db, check_sql, -1, &st, NULL) != SQLITE_OK) return fail(db, "check");
    int ok = 0, rows = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *r = (const char *)sqlite3_column_text(st, 0);
        rows++;
        if (rows == 1 && r && strcmp(r, "ok") == 0) ok = 1;
        else ok = 0;
        fprintf(stderr, "check: %s\n", r ? r : "(null)");
    }
    sqlite3_finalize(st);
    if (!ok) { sqlite3_close(db); fprintf(stderr, "dbstream: check failed\n"); return 3; }

    if (sqlite3_prepare_v2(db, "SELECT pgno, data FROM sqlite_dbpage ORDER BY pgno",
                           -1, &st, NULL) != SQLITE_OK) return fail(db, "dbpage");
    long long written = 0;
    int expect = 1;
    while (sqlite3_step(st) == SQLITE_ROW) {
        int pgno = sqlite3_column_int(st, 0);
        int n = sqlite3_column_bytes(st, 1);
        const void *data = sqlite3_column_blob(st, 1);
        if (pgno != expect || n != page_size) {
            fprintf(stderr, "dbstream: page %d unexpected (expected %d, %d bytes)\n", pgno, expect, n);
            sqlite3_finalize(st); sqlite3_close(db); return 4;
        }
        if (fwrite(data, 1, (size_t)n, stdout) != (size_t)n) {
            fprintf(stderr, "dbstream: write failed at page %d\n", pgno);
            sqlite3_finalize(st); sqlite3_close(db); return 5;
        }
        written++;
        expect++;
    }
    sqlite3_finalize(st);
    sqlite3_exec(db, "COMMIT", NULL, NULL, NULL);
    sqlite3_close(db);
    if (fflush(stdout) != 0) { fprintf(stderr, "dbstream: flush failed\n"); return 5; }
    if (written != page_count) {
        fprintf(stderr, "dbstream: wrote %lld pages, page_count was %d\n", written, page_count);
        return 4;
    }
    fprintf(stderr, "pages: %lld  page_size: %d\n", written, page_size);
    return 0;
}
