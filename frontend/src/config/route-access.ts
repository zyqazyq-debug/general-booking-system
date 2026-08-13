export const AUTH_REDIRECT_PATH = '/pages/login/login';
export const FORBIDDEN_REDIRECT_PATH = '/pages/library/index';

const publicRoutes = new Set([
  'pages/index/index',
  'pages/login/login',
  'pages/login/register',
  'pages/booking/detail',
  'pages/admin/login',
]);

const roleRules = [
  {
    routes: ['pages/admin/dashboard', 'pages/admin/users'],
    roles: ['ADMIN'],
  },
];

const normalizeRoute = (route: string) => (route || '').split('?')[0].replace(/^\/+/, '');

export const isPublicRoute = (route: string) => publicRoutes.has(normalizeRoute(route));

export const getRequiredRoles = (route: string) => {
  const matched = roleRules.find((rule) => rule.routes.includes(normalizeRoute(route)));
  return matched?.roles ?? [];
};
