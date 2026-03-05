import React from 'react'
import { ShieldCheck } from 'lucide-react'

// Schermata placeholder — verrà sostituita nella Fase 5 con i componenti reali
export default function App(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center">
      <div className="text-center space-y-4">
        <ShieldCheck className="mx-auto text-blue-600" size={64} />
        <h1 className="text-3xl font-bold text-slate-800">LegalShield</h1>
        <p className="text-slate-500 text-lg">Anonimizzatore di documenti legali</p>
        <div className="bg-green-100 border border-green-300 rounded-lg px-6 py-3 text-green-700 text-sm font-medium">
          Fase 1 completata — App Electron funzionante
        </div>
        <p className="text-slate-400 text-xs">
          Tutta l'elaborazione avviene localmente. Nessun dato inviato in rete.
        </p>
      </div>
    </div>
  )
}
