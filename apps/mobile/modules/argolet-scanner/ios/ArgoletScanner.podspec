Pod::Spec.new do |s|
  s.name           = 'ArgoletScanner'
  s.version        = '1.0.0'
  s.summary        = 'Document scanner of the iPhone (VisionKit) for ARGOLET'
  s.description    = 'Edge detection, perspective correction and multi-page scanning with VisionKit.'
  s.author         = 'ARGOLET'
  s.homepage       = 'https://github.com/KONKONBAN/ARGOLET'
  s.license        = { type: 'Proprietary' }
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.frameworks     = 'VisionKit'
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = "**/*.{h,m,swift}"
end
