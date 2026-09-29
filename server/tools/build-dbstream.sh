#!/bin/sh
# Build dbstream (see dbstream.c) from the official SQLite amalgamation.
# Run on the VPS from this directory:  sh build-dbstream.sh
# The hash is SQLite's own published SHA3-256 for this exact file; the build
# refuses to continue if the download does not match it.
set -eu
VER=3530400
YEAR=2026
SHA3=628a44cfe82c66aed1ccbbe85a562d2e33ebe64b3288981ed76285612227934e
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -fsSL -o "$work/a.zip" "https://www.sqlite.org/$YEAR/sqlite-amalgamation-$VER.zip"
got=$(python3 -c "import hashlib,sys;print(hashlib.sha3_256(open(sys.argv[1],'rb').read()).hexdigest())" "$work/a.zip")
[ "$got" = "$SHA3" ] || { echo "SHA3-256 mismatch: $got" >&2; exit 1; }
python3 -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$work/a.zip" "$work"
src="$work/sqlite-amalgamation-$VER"
gcc -O2 -DSQLITE_ENABLE_DBPAGE_VTAB -DSQLITE_THREADSAFE=0 -I"$src" \
    -o dbstream dbstream.c "$src/sqlite3.c" -lm
echo "built $(pwd)/dbstream against SQLite $VER"
