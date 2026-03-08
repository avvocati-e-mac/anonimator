import React from 'react'
import {
  User, Building2, MapPin, CreditCard,
  Mail, Phone, Calendar, Home, FileText
} from 'lucide-react'
import type { EntityType } from '@shared/types'

export const ENTITY_CONFIG: Record<EntityType, { label: string; color: string; icon: React.ElementType }> = {
  PERSONA:          { label: 'Persona',        color: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800',           icon: User },
  ORGANIZZAZIONE:   { label: 'Organizzazione', color: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-800', icon: Building2 },
  LUOGO:            { label: 'Luogo',          color: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800',       icon: MapPin },
  CODICE_FISCALE:   { label: 'Cod. Fiscale',   color: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800', icon: CreditCard },
  PARTITA_IVA:      { label: 'P. IVA',         color: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800', icon: CreditCard },
  IBAN:             { label: 'IBAN',           color: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800',                   icon: CreditCard },
  EMAIL:            { label: 'Email',          color: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/40 dark:text-cyan-300 dark:border-cyan-800',             icon: Mail },
  TELEFONO:         { label: 'Telefono',       color: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-800',             icon: Phone },
  DATA_NASCITA:     { label: 'Data nascita',   color: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',       icon: Calendar },
  INDIRIZZO:        { label: 'Indirizzo',      color: 'bg-lime-100 text-lime-700 border-lime-200 dark:bg-lime-900/40 dark:text-lime-300 dark:border-lime-800',             icon: Home },
  NUMERO_DOCUMENTO: { label: 'N. Documento',  color: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800',             icon: FileText },
}
