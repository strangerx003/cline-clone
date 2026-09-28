// Zero-dependency pure JS ZIP builder (Store compression + CRC-32)
// Allows downloading modified workspaces in browsers without File System Access API (e.g. Firefox, Safari)

// Standard CRC-32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

export function crc32(byteArray) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < byteArray.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byteArray[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export class SimpleZip {
  constructor() {
    this.files = [];
  }

  /**
   * Adds a file to the ZIP archive
   * @param {string} path - Relative file path (e.g. "src/main.js")
   * @param {string|Uint8Array} content - Text or binary content
   */
  add(path, content) {
    const cleanPath = path.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    let bytes;
    if (typeof content === 'string') {
      bytes = new TextEncoder().encode(content);
    } else if (content instanceof Uint8Array) {
      bytes = content;
    } else {
      bytes = new Uint8Array(0);
    }

    const crc = crc32(bytes);
    this.files.push({
      path: cleanPath,
      bytes,
      crc,
      size: bytes.length
    });
  }

  /**
   * Generates the ZIP binary Blob
   * @returns {Blob}
   */
  buildBlob() {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    const encoder = new TextEncoder();

    for (const f of this.files) {
      const pathBytes = encoder.encode(f.path);
      const localHeader = new Uint8Array(30 + pathBytes.length);
      const view = new DataView(localHeader.buffer);

      // Local file header signature: 0x04034b50
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true); // Version needed to extract (2.0)
      view.setUint16(6, 0, true);  // General purpose bit flag
      view.setUint16(8, 0, true);  // Compression method: 0 (stored / uncompressed)
      view.setUint16(10, 0, true); // Last mod file time
      view.setUint16(12, 0, true); // Last mod file date
      view.setUint32(14, f.crc, true); // CRC-32
      view.setUint32(18, f.size, true); // Compressed size
      view.setUint32(22, f.size, true); // Uncompressed size
      view.setUint16(26, pathBytes.length, true); // File name length
      view.setUint16(28, 0, true); // Extra field length

      localHeader.set(pathBytes, 30);
      localHeaders.push(localHeader, f.bytes);

      // Central directory header
      const cdHeader = new Uint8Array(46 + pathBytes.length);
      const cdView = new DataView(cdHeader.buffer);

      // Central directory file header signature: 0x02014b50
      cdView.setUint32(0, 0x02014b50, true);
      cdView.setUint16(4, 20, true); // Version made by
      cdView.setUint16(6, 20, true); // Version needed to extract
      cdView.setUint16(8, 0, true);  // General purpose bit flag
      cdView.setUint16(10, 0, true); // Compression method: 0
      cdView.setUint16(12, 0, true); // Mod time
      cdView.setUint16(14, 0, true); // Mod date
      cdView.setUint32(16, f.crc, true); // CRC-32
      cdView.setUint32(20, f.size, true); // Compressed size
      cdView.setUint32(24, f.size, true); // Uncompressed size
      cdView.setUint16(28, pathBytes.length, true); // File name length
      cdView.setUint16(30, 0, true); // Extra field length
      cdView.setUint16(32, 0, true); // Comment length
      cdView.setUint16(34, 0, true); // Disk number start
      cdView.setUint16(36, 0, true); // Internal file attributes
      cdView.setUint32(38, 0, true); // External file attributes
      cdView.setUint32(42, offset, true); // Relative offset of local header

      cdHeader.set(pathBytes, 46);
      centralHeaders.push(cdHeader);

      offset += localHeader.length + f.bytes.length;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const part of centralHeaders) {
      cdSize += part.length;
    }

    // End of central directory record
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);

    // End of central dir signature: 0x06054b50
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true); // Disk number
    eocdView.setUint16(6, 0, true); // Disk where central directory starts
    eocdView.setUint16(8, this.files.length, true); // Number of central directory records on this disk
    eocdView.setUint16(10, this.files.length, true); // Total number of central directory records
    eocdView.setUint32(12, cdSize, true); // Size of central directory
    eocdView.setUint32(16, cdOffset, true); // Offset of start of central directory
    eocdView.setUint16(20, 0, true); // Comment length

    return new Blob([...localHeaders, ...centralHeaders, eocd], { type: 'application/zip' });
  }

  /**
   * Triggers a browser download of the ZIP file
   */
  download(filename = 'workspace.zip') {
    const blob = this.buildBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 2000);
  }
}
