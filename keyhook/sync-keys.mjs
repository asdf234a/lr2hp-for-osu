// Reads your osu!mania key bindings from osu!lazer and osu!stable and writes them
// to the LR2 HP overlay as keybinds.json, so its key layout matches the game.
//
//   node sync-keys.mjs [--out <overlay folder>] [--lazer <data folder>] [--stable <game folder>]
//
// Folders come from tosu when it's running (the client it's attached to), then
// from osu!'s usual places. lazer keeps bindings in client.realm, which is read
// from a temporary copy; the game's own file is never opened. stable keeps them as
// text in osu!.<user>.cfg.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lazerLayouts, parseStableConfig } from './keymaps.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : null;
}

const isDir = (p) => {
    try {
        return !!p && fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
};

async function fromTosu(host) {
    try {
        const res = await fetch(`http://${host}/json/v2`, { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return {};
        const data = await res.json();
        const folders = data.folders || {};
        if (data.client === 'lazer' && folders.songs) return { lazer: path.dirname(folders.songs) };
        if (data.client === 'stable' && folders.game) return { stable: folders.game };
    } catch {
        // tosu not running
    }
    return {};
}

function lazerFromStorageIni() {
    const base = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'osu');
    try {
        const ini = fs.readFileSync(path.join(base, 'storage.ini'), 'utf8');
        const m = /^\s*FullPath\s*=\s*(.+?)\s*$/m.exec(ini);
        if (m && isDir(m[1])) return m[1];
    } catch {
        // no custom storage location
    }
    return isDir(base) ? base : null;
}

function stableFromRegistry() {
    for (const key of ['HKCR\\osu\\shell\\open\\command', 'HKCR\\osustable.File.osz\\shell\\open\\command']) {
        try {
            const out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const m = /"([^"]+osu!\.exe)"/i.exec(out);
            if (m && isDir(path.dirname(m[1]))) return path.dirname(m[1]);
        } catch {
            // key missing
        }
    }
    const local = path.join(process.env.LOCALAPPDATA || '', 'osu!');
    return fs.existsSync(path.join(local, 'osu!.exe')) ? local : null;
}

async function readLazer(dir) {
    const file = ['client.realm'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    if (!file) return { error: `no client.realm in ${dir}` };
    let Realm;
    try {
        Realm = (await import('realm')).default;
    } catch {
        return { error: 'the realm package is missing (run "npm install" in the keyhook folder)' };
    }
    const copy = path.join(os.tmpdir(), `lr2hp-client-${process.pid}.realm`);
    fs.copyFileSync(file, copy);
    try {
        const realm = await Realm.open({ path: copy, readOnly: true });
        try {
            const rows = realm.objects('KeyBinding').filtered('RulesetName == "mania"');
            return { layouts: lazerLayouts([...rows].map((r) => ({ Variant: r.Variant, Action: r.Action, KeyCombination: r.KeyCombination }))), file };
        } finally {
            realm.close();
        }
    } catch (e) {
        return { error: `could not read ${file}: ${e.message}` };
    } finally {
        for (const f of [copy, `${copy}.lock`, `${copy}.note`]) fs.rmSync(f, { force: true });
        fs.rmSync(`${copy}.management`, { recursive: true, force: true });
    }
}

function readStable(dir) {
    const user = os.userInfo().username;
    let file = path.join(dir, `osu!.${user}.cfg`);
    if (!fs.existsSync(file)) {
        // osu! names the file after the Windows user; fall back to the newest one
        const candidates = fs
            .readdirSync(dir)
            .filter((f) => /^osu!\..+\.cfg$/i.test(f) && f.toLowerCase() !== 'osu!.cfg')
            .map((f) => path.join(dir, f))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        file = candidates[0];
    }
    if (!file) return { error: `no osu!.<user>.cfg in ${dir}` };
    return { layouts: parseStableConfig(fs.readFileSync(file, 'utf8')), file };
}

async function main() {
    const host = arg('tosu') || '127.0.0.1:24050';
    const out = arg('out') || path.join(here, '..', 'static', 'lr2hp');
    const tosu = await fromTosu(host);
    const lazerDir = arg('lazer') || tosu.lazer || lazerFromStorageIni();
    const stableDir = arg('stable') || tosu.stable || stableFromRegistry();

    const result = { updated: new Date().toISOString(), lazer: {}, stable: {}, sources: {} };
    for (const [client, dir, read] of [['lazer', lazerDir, readLazer], ['stable', stableDir, readStable]]) {
        if (!isDir(dir)) {
            console.log(`${client}: not found`);
            continue;
        }
        const r = await read(dir);
        if (r.error) {
            console.log(`${client}: ${r.error}`);
            continue;
        }
        result[client] = r.layouts;
        result.sources[client] = r.file;
        console.log(`${client}: ${r.file}`);
        for (const [keys, layout] of Object.entries(r.layouts).sort((a, b) => a[0] - b[0])) console.log(`  ${keys}K  ${layout}`);
    }

    if (!isDir(out)) {
        console.log(`overlay folder not found: ${out} (use --out)`);
        process.exitCode = 1;
        return;
    }
    fs.writeFileSync(path.join(out, 'keybinds.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log(`saved ${path.join(out, 'keybinds.json')}`);
}

// realm keeps background threads alive, so exit explicitly
main().then(
    () => process.exit(process.exitCode || 0),
    (e) => {
        console.error(e);
        process.exit(1);
    },
);
