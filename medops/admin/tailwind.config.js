/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        /* DEFAULT 由 #2F6BFF 微调为 #2E69FA：原值白字对比度 4.4988:1，
           差 0.0012 差在 WCAG AA 的 4.5 门槛之下（按钮白字、白底链接色都受影响）。
           调深一档后 4.65:1，与资产系统的蓝仍属同一色相，肉眼分辨不出。 */
        primary: {
          DEFAULT: '#2E69FA',
          hover: '#255AE0',
          light: '#EFF4FF'
        }
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'PingFang SC', 'Microsoft YaHei', 'sans-serif']
      }
    }
  },
  plugins: []
}
