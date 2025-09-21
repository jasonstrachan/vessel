import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import GlobalErrorBoundary from '../components/GlobalErrorBoundary';
import GlobalErrorHooks from '../components/GlobalErrorHooks';

export const metadata: Metadata = {
  title: 'tinybrush',
  description: 'Simple pixel art editor',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Script id="tb-strip-password-managers" strategy="beforeInteractive">
          {`(function() {
  if (typeof document === 'undefined') {
    return;
  }

  var prefixes = ['data-dashlane'];

  var shouldStrip = function(name) {
    if (!name) {
      return false;
    }
    for (var i = 0; i < prefixes.length; i += 1) {
      if (name.indexOf(prefixes[i]) === 0) {
        return true;
      }
    }
    return false;
  };

  var sanitizeNode = function(node) {
    if (!node || node.nodeType !== 1 || !node.attributes) {
      return;
    }

    for (var i = node.attributes.length - 1; i >= 0; i -= 1) {
      var attribute = node.attributes[i];
      if (attribute && shouldStrip(attribute.name)) {
        node.removeAttribute(attribute.name);
      }
    }
  };

  var sanitizeTree = function(root) {
    if (!root) {
      return;
    }

    sanitizeNode(root);

    if (!root.querySelectorAll) {
      return;
    }

    var elements = root.querySelectorAll('*');
    for (var i = 0; i < elements.length; i += 1) {
      sanitizeNode(elements[i]);
    }
  };

  var root = document.documentElement;
  if (!root) {
    return;
  }

  sanitizeTree(root);

  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i += 1) {
      var mutation = mutations[i];

      if (mutation.type === 'attributes' && shouldStrip(mutation.attributeName)) {
        mutation.target.removeAttribute(mutation.attributeName);
        continue;
      }

      if (mutation.type !== 'childList' || !mutation.addedNodes) {
        continue;
      }

      for (var j = 0; j < mutation.addedNodes.length; j += 1) {
        var node = mutation.addedNodes[j];
        if (node && node.nodeType === 1) {
          sanitizeTree(node);
        }
      }
    }
  });

  observer.observe(root, { attributes: true, childList: true, subtree: true });

  window.addEventListener('load', function() {
    setTimeout(function() {
      observer.disconnect();
    }, 5000);
  });
})();`}
        </Script>
        <GlobalErrorBoundary>
          <GlobalErrorHooks />
          {children}
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}
