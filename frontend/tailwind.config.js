/**
 * Tokens do design system "Quiet Luxury" — dark editorial.
 * Toda cor/tipografia/raio nasce aqui; as telas só consomem tokens.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Fundos grafite/preto profundo
        grafite: {
          950: '#0A0A0C',
          900: '#0F0F12',
          850: '#141418',
          800: '#1A1A20',
          700: '#26262E',
        },
        // Texto: tom osso (quente, não branco puro)
        osso: {
          DEFAULT: '#E9E5DC',
          suave: '#B9B4A8',
          mudo: '#7E7A70',
        },
        // Acento neutro sofisticado: bronze envelhecido
        bronze: {
          DEFAULT: '#C8AE7E',
          claro: '#E0CCA4',
          escuro: '#8F7A52',
        },
        // Estados, dessaturados para não gritar no dark
        estado: {
          ok: '#8FBC9F',
          erro: '#C98A80',
          aviso: '#CDB37E',
          info: '#8FA8BC',
        },
      },
      borderColor: {
        linha: 'rgba(233, 229, 220, 0.08)',
        'linha-forte': 'rgba(233, 229, 220, 0.16)',
      },
      backgroundColor: {
        vidro: 'rgba(233, 229, 220, 0.03)',
        'vidro-forte': 'rgba(233, 229, 220, 0.06)',
      },
      fontFamily: {
        editorial: ['Fraunces', 'Georgia', 'serif'],
        corpo: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        cartao: '14px',
        campo: '10px',
      },
      letterSpacing: {
        etiqueta: '0.14em',
      },
    },
  },
  plugins: [],
};
