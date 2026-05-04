'use client';

import { motion } from 'framer-motion';

export function VisionSection() {
  return (
    <section id="vision" className="py-32 relative border-t border-white/5 bg-black">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto text-center">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-3xl md:text-5xl font-bold mb-8 text-white"
          >
            El fin de las herramientas complejas.
          </motion.h2>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-lg md:text-xl text-gray-400 leading-relaxed mb-8"
          >
            Durante décadas, el trading algorítmico estuvo reservado para instituciones en "salas de servidores frías" con interfaces mediocres. Nosotros creemos que el poder absoluto del software no tiene por qué estar reñido con un diseño excepcional.
          </motion.p>
          
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg md:text-xl text-gray-400 leading-relaxed"
          >
            Hemos unificado un motor escalable que procesa millones de datos en milisegundos, con una estética de cristal y fluidez que inspira a invertir. No es solo trading; es una obra de arte interactiva.
          </motion.p>
        </div>
      </div>
    </section>
  );
}
