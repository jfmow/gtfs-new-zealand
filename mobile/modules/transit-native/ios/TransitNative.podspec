Pod::Spec.new do |s|
  s.name           = 'TransitNative'
  s.version        = '0.1.0'
  s.summary        = 'Live Activities and the app group for the Transit app'
  s.author         = ''
  s.homepage       = 'https://trains.suddsy.dev'
  s.license        = 'MIT'
  s.platforms      = { :ios => '17.2' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.frameworks = 'ActivityKit', 'WidgetKit'
end
