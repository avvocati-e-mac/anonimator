// Scrittore PDF minimale e deterministico.
// Serve a costruire fixture con controllo totale su oggetti, stream, filtri,
// MediaBox/CropBox/Rotate/UserUnit e font: cose che una libreria di alto livello
// non permette di sbagliare "apposta".
//
// Nessuna data di sistema, nessun UUID casuale: l'output è riproducibile.

import { deflateSync } from 'node:zlib'

/** Data fissa: la riproducibilità bit-per-bit vale più della verità anagrafica del file. */
const FIXED_DATE = 'D:20260101000000Z'
const FIXED_ID = '0123456789ABCDEF0123456789ABCDEF'

export class Pdf {
  constructor() {
    /** @type {(string|{head:string,data:Buffer}|null)[]} indice 0 => oggetto 1 */
    this.objs = []
  }

  /** Riserva un numero d'oggetto senza ancora definirne il corpo (riferimenti circolari). */
  reserve() {
    this.objs.push(null)
    return this.objs.length
  }

  set(num, body) {
    this.objs[num - 1] = body
    return num
  }

  add(body) {
    return this.set(this.reserve(), body)
  }

  /**
   * Aggiunge un oggetto stream.
   * @param {string} dict voci del dizionario, senza le parentesi << >>
   * @param {Buffer|string} bytes contenuto grezzo
   * @param {{compress?: boolean}} opts compress applica FlateDecode
   */
  addStream(dict, bytes, opts = {}) {
    const num = this.reserve()
    return this.setStream(num, dict, bytes, opts)
  }

  setStream(num, dict, bytes, opts = {}) {
    let data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'latin1')
    let extra = ''
    if (opts.compress) {
      data = deflateSync(data, { level: 9 })
      extra = ' /Filter /FlateDecode'
    }
    const head = `<< ${dict}${extra} /Length ${data.length} >>\nstream\n`
    return this.set(num, { head, data })
  }

  toBuffer(rootRef) {
    const chunks = []
    let pos = 0
    const push = (buf) => {
      const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'latin1')
      chunks.push(b)
      pos += b.length
    }

    push('%PDF-1.7\n')
    push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

    const offsets = new Array(this.objs.length).fill(0)
    for (let i = 0; i < this.objs.length; i++) {
      const body = this.objs[i]
      if (body === null) throw new Error(`Oggetto ${i + 1} riservato ma mai definito`)
      offsets[i] = pos
      push(`${i + 1} 0 obj\n`)
      if (typeof body === 'string') {
        push(body)
        push('\nendobj\n')
      } else {
        push(body.head)
        push(body.data)
        push('\nendstream\nendobj\n')
      }
    }

    const xrefPos = pos
    const n = this.objs.length + 1
    let xref = `xref\n0 ${n}\n0000000000 65535 f \n`
    for (let i = 0; i < this.objs.length; i++) {
      xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
    }
    push(xref)
    push(
      `trailer\n<< /Size ${n} /Root ${rootRef} 0 R ` +
        `/ID [<${FIXED_ID}> <${FIXED_ID}>] >>\nstartxref\n${xrefPos}\n%%EOF\n`
    )

    return Buffer.concat(chunks)
  }
}

/** Stringa letterale PDF con escaping corretto. */
export function litStr(s) {
  return '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')'
}

/** Stringa esadecimale PDF (usata per le CID a 2 byte di Identity-H). */
export function hexStr(bytes) {
  return '<' + Buffer.from(bytes).toString('hex').toUpperCase() + '>'
}

export const PDF_FIXED_DATE = FIXED_DATE
