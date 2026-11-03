import localFont from 'next/font/local';

// Google Sans variable (OFL, see public/fonts/OFL.txt). Normal axis only; italic is not used yet.
export const googleSans = localFont({
  src: '../../public/fonts/GoogleSans-Variable.ttf',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
  variable: '--font-google-sans',
});
