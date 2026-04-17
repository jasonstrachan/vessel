import React from 'react';
import { Head, Html, Main, NextScript } from 'next/document';

export default function Document() {
  return React.createElement(
    Html,
    { lang: 'en' },
    React.createElement(Head),
    React.createElement(
      'body',
      null,
      React.createElement(Main),
      React.createElement(NextScript),
    ),
  );
}
