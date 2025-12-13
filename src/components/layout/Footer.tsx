"use client";

import React from 'react';

export default function Footer() {
  return (
    <footer className="bg-gray-800 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center text-sm text-gray-400">
          <p>&copy; {new Date().getFullYear()} SG-LOK. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

