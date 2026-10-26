import base from '@ariforce/config/eslint';
export default [...base, { ignores: ['next-env.d.ts', '.next/**', '.next-real/**', 'public/vendor/**'] }];
