// Cloudflare Pages Function: fdoc.fiber911.com/otdr
// A deliberately old-school upload page so the MaxTester MAX-700's built-in
// Internet Explorer can send OTDR files (.sor, .trc, PDF, screenshots) over Wi-Fi.
// Files are forwarded to the Panel Guide Apps Script, which drops them in the
// "OTDR Inbox" Drive folder. Assign them to a location in the app.
//
// Needs 3 environment variables in Cloudflare Pages → Settings → Variables and Secrets:
//   SCRIPT_URL  = the Apps Script web app URL (ends in /exec)
//   SYNC_KEY    = the sync key (same one the app uses)
//   UPLOAD_PIN  = a short PIN techs type on the upload page (e.g. 4-6 digits)

const MAX_BYTES = 40 * 1024 * 1024; // per file

function page(body, title) {
  // no JavaScript, no modern CSS: works on IE8+
  return new Response(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title || "Fiber911 OTDR Upload"}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#F5F7FB;color:#1b1f2e;font-size:18px}
.top{background:#1F2A5C;color:#fff;padding:14px 18px;border-bottom:4px solid #C8102E;font-size:24px;font-weight:bold}
.top span{font-size:14px;font-weight:normal;color:#b9c3e6}
.box{background:#fff;border:1px solid #C9D0E3;margin:16px;padding:16px}
label{display:block;font-weight:bold;color:#1F2A5C;font-size:15px;margin:14px 0 4px}
input.t{width:95%;font-size:20px;padding:8px;border:1px solid #9AA3BF}
input.f{font-size:16px;margin:6px 0;display:block}
.go{background:#00AEEF;color:#fff;border:0;font-size:24px;font-weight:bold;padding:14px 30px;margin-top:18px;cursor:pointer}
.ok{color:#006100;font-weight:bold}.err{color:#C8102E;font-weight:bold}
.note{color:#5d6680;font-size:14px}
table{border-collapse:collapse;width:100%;font-size:15px}td{border-bottom:1px solid #ddd;padding:6px}
a{color:#0070C0}
</style></head><body>
<div class="top">FIBER911 &middot; OTDR Upload <span>Panel Guide inbox</span></div>
${body}
</body></html>`, {headers: {"content-type": "text/html; charset=utf-8", "cache-control": "no-store"}});
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c])); }

function formHTML(msg, pinVal, noteVal) {
  let files = "";
  for (let i = 1; i <= 8; i++) files += `<input class="f" type="file" name="file${i}">`;
  return `${msg || ""}
<form class="box" method="post" action="/otdr" enctype="multipart/form-data">
  <label>PIN</label><input class="t" type="password" name="pin" value="${esc(pinVal)}" autocomplete="off">
  <label>Where / what (optional, helps you sort later)</label>
  <input class="t" type="text" name="note" value="${esc(noteVal)}" placeholder="e.g. Cooper Vault SC-12, fibers 1-12">
  <label>Files (up to 8 at a time: .sor, .trc, PDF, JPG/BMP screenshots)</label>
  ${files}
  <input class="go" type="submit" value="Upload">
  <p class="note">Files go to the <b>OTDR Inbox</b>. Open the Panel Guide app &rarr; OTDR Inbox to assign them to a location, panel or splice.</p>
</form>`;
}

export async function onRequestGet() {
  return page(formHTML());
}

export async function onRequestPost({request, env}) {
  if (!env.SCRIPT_URL || !env.SYNC_KEY || !env.UPLOAD_PIN) {
    return page(formHTML(`<p class="box err">Upload page not configured yet (missing SCRIPT_URL, SYNC_KEY or UPLOAD_PIN in Cloudflare).</p>`));
  }
  let form;
  try { form = await request.formData(); } catch (e) { return page(formHTML(`<p class="box err">Could not read the upload. Try fewer or smaller files.</p>`)); }
  const pin = String(form.get("pin") || "").trim();
  const note = String(form.get("note") || "").trim().slice(0, 200);
  if (pin !== String(env.UPLOAD_PIN).trim()) return page(formHTML(`<p class="box err">Wrong PIN.</p>`, "", note));

  const rows = [];
  for (const [key, val] of form.entries()) {
    if (!key.startsWith("file") || typeof val === "string" || !val || !val.size) continue;
    const name = String(val.name || "file").split(/[\\/]/).pop(); // old IE sends the full path
    if (val.size > MAX_BYTES) { rows.push(`<tr><td>${esc(name)}</td><td class="err">too big (${(val.size / 1048576).toFixed(1)} MB)</td></tr>`); continue; }
    try {
      const buf = new Uint8Array(await val.arrayBuffer());
      let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      const res = await fetch(env.SCRIPT_URL, {
        method: "POST", redirect: "follow",
        headers: {"content-type": "text/plain;charset=utf-8"},
        body: JSON.stringify({action: "inboxUpload", key: env.SYNC_KEY, name, type: val.type || guessType(name), note, source: "MaxTester upload page", data: btoa(bin)})
      });
      const j = await res.json();
      rows.push(j.ok ? `<tr><td>${esc(name)}</td><td class="ok">uploaded (${Math.max(1, Math.round(val.size / 1024))} KB)</td></tr>`
                     : `<tr><td>${esc(name)}</td><td class="err">${esc(j.error || "failed")}</td></tr>`);
    } catch (e) {
      rows.push(`<tr><td>${esc(name)}</td><td class="err">failed: ${esc(e.message)}</td></tr>`);
    }
  }
  if (!rows.length) return page(formHTML(`<p class="box err">No files selected.</p>`, pin, note));
  return page(`<div class="box"><b>Upload results</b><table>${rows.join("")}</table></div>` + formHTML("", pin, note));
}

function guessType(n) {
  n = n.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".bmp")) return "image/bmp";
  return "application/octet-stream";
}
