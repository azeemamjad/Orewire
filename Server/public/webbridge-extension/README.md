# Load this folder in Chrome

1. `chrome://extensions` → Developer mode → **Load unpacked** (or **Reload** if already loaded)
2. Choose **this directory** (`Server/public/webbridge-extension`) — v0.2.0
3. On the VA laptop: `cd Server && node index` with `WEBBRIDGE=1`
4. Open **OreWire Bridge** popup:
   - Reserved domain: `elwanda-liverless-dendritically.ngrok-free.dev` (or yours)
   - Paste **ngrok authtoken** (first time; later optional if saved)
   - **Connect & get URL**
5. Copy Connection URL + Bridge token → OreWire Admin → Social Automation

Full guide: `Server/lib/webbridge/README.md`
