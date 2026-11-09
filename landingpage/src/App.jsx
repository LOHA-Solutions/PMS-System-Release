import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import MarketingLayout from './apps/marketing/layouts/MarketingLayout.jsx';
import Home from './apps/marketing/Home.jsx';
import Pricing from './apps/marketing/Pricing.jsx';
import Blog from './apps/marketing/Blog.jsx';
import Contact from './apps/marketing/Contact.jsx';
import LegacyI18nBridge from './shared/i18n/LegacyI18nBridge.jsx';
import { t, useI18n } from './shared/i18n/useI18n.js';

function PublicLayout() {
  return (
    <>
      <MarketingLayout />
      <LegacyI18nBridge />
    </>
  );
}

function PublicError({ status = 500 }) {
  useI18n();
  return (
    <main className="loha-home loha-public-error">
      <div className="loha-container">
        <p className="loha-kicker">LOHA PMS · {status}</p>
        <h1>
          {t(status === 404 ? 'errors.notFoundTitle' : 'errors.serverTitle')}
        </h1>
        <p>
          {t(
            status === 404
              ? 'errors.notFoundDescription'
              : 'errors.serverDescription',
          )}
        </p>
        <a className="loha-button loha-button-primary" href="/">
          {t('auth.home')}
        </a>
      </div>
    </main>
  );
}

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    errorElement: <PublicError />,
    children: [
      { index: true, element: <Home /> },
      { path: 'pricing', element: <Pricing /> },
      { path: 'blog', element: <Blog /> },
      { path: 'contact', element: <Contact /> },
      { path: '*', element: <PublicError status={404} /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
