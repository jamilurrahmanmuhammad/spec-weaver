import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileJson, FileText, Zap, Shield, GitBranch, ArrowRightLeft } from 'lucide-react';
import { Button } from './ui/Button';

export const Home: React.FC = () => {
  return (
    <div className="flex flex-col min-h-screen">
      
      {/* Hero Section */}
      <section className="relative bg-white overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="relative z-10 pb-8 bg-white sm:pb-16 md:pb-20 lg:max-w-2xl lg:w-full lg:pb-28 xl:pb-32">
            <main className="mt-10 mx-auto max-w-7xl px-4 sm:mt-12 sm:px-6 md:mt-16 lg:mt-20 lg:px-8 xl:mt-28">
              <div className="sm:text-center lg:text-left">
                <h1 className="text-4xl tracking-tight font-extrabold text-gray-900 sm:text-5xl md:text-6xl">
                  <span className="block xl:inline">Seamlessly convert</span>{' '}
                  <span className="block text-indigo-600 xl:inline">API Specs & Docs</span>
                </h1>
                <p className="mt-3 text-base text-gray-500 sm:mt-5 sm:text-lg sm:max-w-xl sm:mx-auto md:mt-5 md:text-xl lg:mx-0">
                  SpecWeaver bridges the gap between developers and technical writers. Transform OpenAPI YAML/JSON into professional Word documents, or parse structured documentation back into valid specs instantly.
                </p>
                <div className="mt-5 sm:mt-8 sm:flex sm:justify-center lg:justify-start">
                  <div className="rounded-md shadow">
                    <Link to="/app">
                      <Button className="w-full h-12 text-lg px-8">
                        Get Started
                        <ArrowRight className="ml-2" size={20}/>
                      </Button>
                    </Link>
                  </div>
                  <div className="mt-3 sm:mt-0 sm:ml-3">
                    <a href="#features">
                      <Button variant="ghost" className="w-full h-12 text-lg px-8">
                        Learn More
                      </Button>
                    </a>
                  </div>
                </div>
              </div>
            </main>
          </div>
        </div>
        <div className="lg:absolute lg:inset-y-0 lg:right-0 lg:w-1/2 bg-slate-50 border-l border-slate-100 flex items-center justify-center">
            <div className="grid grid-cols-2 gap-4 p-8 opacity-75 transform rotate-3 scale-90">
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-slate-100 h-64 w-56 flex flex-col justify-between">
                    <div className="h-2 w-20 bg-indigo-100 rounded"></div>
                    <div className="space-y-2">
                        <div className="h-2 w-full bg-slate-100 rounded"></div>
                        <div className="h-2 w-full bg-slate-100 rounded"></div>
                        <div className="h-2 w-3/4 bg-slate-100 rounded"></div>
                    </div>
                    <div className="mt-4 p-3 bg-slate-50 rounded-lg">
                        <Code2Icon className="text-indigo-500 mb-2" />
                        <div className="h-2 w-16 bg-slate-200 rounded"></div>
                    </div>
                </div>
                <div className="bg-indigo-600 p-6 rounded-2xl shadow-lg h-64 w-56 flex flex-col justify-between text-white mt-12">
                     <FileTextIcon className="text-white/80" />
                     <div className="space-y-3">
                        <div className="h-2 w-full bg-white/20 rounded"></div>
                        <div className="h-2 w-full bg-white/20 rounded"></div>
                        <div className="h-2 w-full bg-white/20 rounded"></div>
                     </div>
                     <div className="h-8 w-24 bg-white/20 rounded-lg"></div>
                </div>
            </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-base text-indigo-600 font-semibold tracking-wide uppercase">Features</h2>
            <p className="mt-2 text-3xl leading-8 font-extrabold tracking-tight text-gray-900 sm:text-4xl">
              Everything you need to manage API docs
            </p>
          </div>

          <div className="mt-16">
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  title: 'Bi-Directional Conversion',
                  desc: 'Convert OpenAPI (YAML/JSON) to Docx and vice-versa with high fidelity.',
                  icon: <ArrowRightLeft className="h-6 w-6 text-white" />,
                },
                {
                  title: 'Instant Processing',
                  desc: 'Run entirely in your browser with no API latency or external dependencies.',
                  icon: <Zap className="h-6 w-6 text-white" />,
                },
                {
                  title: 'Customizable Output',
                  desc: 'Adjust details and target audience for your generated documents.',
                  icon: <SettingsIcon className="h-6 w-6 text-white" />,
                },
                {
                  title: 'Format Validation',
                  desc: 'Ensures generated OpenAPI specs are syntactically valid and structured correctly.',
                  icon: <Shield className="h-6 w-6 text-white" />,
                },
                {
                  title: 'Markdown & HTML Support',
                  desc: 'Preview in real-time with rich Markdown rendering before downloading.',
                  icon: <FileText className="h-6 w-6 text-white" />,
                },
                {
                  title: 'Schema Parsing',
                  desc: 'Deterministically maps documentation headers back to API paths.',
                  icon: <GitBranch className="h-6 w-6 text-white" />,
                },
              ].map((feature, idx) => (
                <div key={idx} className="pt-6">
                  <div className="flow-root bg-white rounded-lg px-6 pb-8 shadow-sm h-full hover:shadow-md transition-shadow border border-slate-100">
                    <div className="-mt-6">
                      <div>
                        <span className="inline-flex items-center justify-center p-3 bg-indigo-500 rounded-md shadow-lg">
                          {feature.icon}
                        </span>
                      </div>
                      <h3 className="mt-8 text-lg font-medium text-gray-900 tracking-tight">{feature.title}</h3>
                      <p className="mt-5 text-base text-gray-500">
                        {feature.desc}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 mt-auto">
        <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
             <p className="text-base text-slate-400">
              &copy; 2024 SpecWeaver. All rights reserved.
            </p>
            <div className="flex space-x-6 text-slate-400">
                <span>Runs Locally</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

// Simple icon wrappers for the illustration
const Code2Icon = ({className}:{className?: string}) => (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>
)
const FileTextIcon = ({className}:{className?: string}) => (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
)
const SettingsIcon = ({className}:{className?: string}) => (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
)