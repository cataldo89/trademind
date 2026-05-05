'use client';

import { motion } from 'framer-motion';
import { Cpu, LineChart, Zap, Shield, Database, Layout } from 'lucide-react';

const features = [
  {
    icon: <Cpu className="w-6 h-6 text-emerald-400" />,
    title: 'IA Desacoplada',
    description: 'Algoritmos procesados en el backend, emitiendo señales precisas sin sobrecargar tu dispositivo.'
  },
  {
    icon: <Zap className="w-6 h-6 text-yellow-400" />,
    title: 'Supabase Realtime',
    description: 'Conexión por WebSockets para ver cada movimiento del mercado en tiempo real. Cero latencia visual.'
  },
  {
    icon: <Layout className="w-6 h-6 text-blue-400" />,
    title: 'Glassmorphism UX',
    description: 'Diseño premium inspirado en la filosofía de "cero cajas beige". Elegancia en cada píxel.'
  },
  {
    icon: <Database className="w-6 h-6 text-purple-400" />,
    title: 'Estado Ultra Ligero',
    description: 'Implementación de Zustand para manejar flujos masivos de datos en la UI de forma suave y sin bloqueos.'
  },
  {
    icon: <LineChart className="w-6 h-6 text-pink-400" />,
    title: 'Gráficos Profesionales',
    description: 'Integración nativa de TradingView Lightweight Charts para una experiencia analítica insuperable.'
  },
  {
    icon: <Shield className="w-6 h-6 text-indigo-400" />,
    title: 'Arquitectura Segura',
    description: 'Lógica pesada e integraciones de API protegidas en Server Actions y API Routes de Next.js.'
  }
];

export function FeatureGrid() {
  return (
    <section className="py-32 relative bg-black">
      <div className="container mx-auto px-4">
        <div className="text-center mb-20">
          <h2 className="text-3xl md:text-5xl font-bold mb-6 text-white">Ingeniería de Clase Mundial</h2>
          <p className="text-gray-400 max-w-2xl mx-auto text-lg">
            La infraestructura que soporta TradeMind está construida bajo los más altos estándares modernos.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="p-8 rounded-3xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] transition-colors backdrop-blur-sm group"
            >
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                {feature.icon}
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">{feature.title}</h3>
              <p className="text-gray-400 leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

# bumped: 2026-05-05T04:21:00