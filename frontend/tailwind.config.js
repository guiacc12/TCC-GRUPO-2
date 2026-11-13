/**
 * Tokens do design system "Quiet Luxury" — dark editorial.
 * Toda cor/tipografia/raio nasce aqui; as telas só consomem tokens.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Tinta: tom fixo, sempre escuro — não inverte com o tema. Usado como texto sobre o acento bronze
        // (ver estilos/global.css), garantindo contraste independente de claro/escuro.
        tinta: 'rgb(var(--tinta) / <alpha-value>)',
        // Fundos — canais vêm de variáveis CSS (ver estilos/global.css) para suportar tema claro/escuro.
        // Formato rgb(var(--x) / <alpha-value>): preserva o suporte a classes com opacidade (ex.: bg-bronze/30).
        grafite: {
          950: 'rgb(var(--grafite-950) / <alpha-value>)',
          900: 'rgb(var(--grafite-900) / <alpha-value>)',
          850: 'rgb(var(--grafite-850) / <alpha-value>)',
          800: 'rgb(var(--grafite-800) / <alpha-value>)',
          700: 'rgb(var(--grafite-700) / <alpha-value>)',
        },
        // Texto
        osso: {
          DEFAULT: 'rgb(var(--osso) / <alpha-value>)',
          suave: 'rgb(var(--osso-suave) / <alpha-value>)',
          mudo: 'rgb(var(--osso-mudo) / <alpha-value>)',
        },
        // Acento neutro sofisticado: bronze envelhecido
        bronze: {
          DEFAULT: 'rgb(var(--bronze) / <alpha-value>)',
          claro: 'rgb(var(--bronze-claro) / <alpha-value>)',
          escuro: 'rgb(var(--bronze-escuro) / <alpha-value>)',
        },
        // Estados, dessaturados para não gritar no dark
        estado: {
          ok: 'rgb(var(--estado-ok) / <alpha-value>)',
          erro: 'rgb(var(--estado-erro) / <alpha-value>)',
          aviso: 'rgb(var(--estado-aviso) / <alpha-value>)',
          info: 'rgb(var(--estado-info) / <alpha-value>)',
        },
      },
      borderColor: {
        linha: 'var(--linha)',
        'linha-forte': 'var(--linha-forte)',
      },
      backgroundColor: {
        vidro: 'var(--vidro)',
        'vidro-forte': 'var(--vidro-forte)',
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
