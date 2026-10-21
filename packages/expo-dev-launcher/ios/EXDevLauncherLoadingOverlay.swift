// Copyright 2015-present 650 Industries. All rights reserved.

import Foundation

#if os(iOS) || os(tvOS)
import UIKit
#endif

/// Shown from the moment the launcher starts loading a project URL until the project's first
/// content appears (or loading fails).
///
/// Opening a project by URL (a scanned QR code, a deep link, the last-opened project at launch)
/// used to leave whatever was on screen in place while the manifest was fetched and the bundle
/// requested, which on a slow or tunneled dev server is many seconds with nothing to say the app
/// is doing anything. The React Native loading banner only appears once the bundle download
/// starts, and only when the manifest enables it.
///
/// The overlay lives in its own window just above the app's, so it covers the launcher or a
/// previously running project, and stays below React Native's own loading banner, LogBox and
/// system alerts.
@objc(EXDevLauncherLoadingOverlay)
public final class DevLauncherLoadingOverlay: NSObject {
  @objc public static let shared = DevLauncherLoadingOverlay()

  /// If the project's content never reports that it appeared, stop covering it this long after
  /// its JavaScript loaded.
  static let hideAfterJavaScriptLoad: TimeInterval = 3

  #if os(iOS) || os(tvOS)
  private var window: UIWindow?
  private var viewController: LoadingViewController?
  #endif
  private var observers: [NSObjectProtocol] = []
  private var generation = 0

  /// Covers the screen while `url` loads. Safe to call again for a new URL.
  @objc
  public func show(for url: URL) {
    #if os(iOS) || os(tvOS)
    onMain { [weak self] in
      guard let self else {
        return
      }
      self.generation += 1
      let controller = self.viewController ?? LoadingViewController()
      controller.setProject(Self.displayName(for: url))
      controller.setStatus(NSLocalizedString("Connecting to the development server…", comment: ""))
      self.viewController = controller

      if self.window == nil {
        guard let window = Self.makeWindow() else {
          return
        }
        window.rootViewController = controller
        self.window = window
      }
      self.window?.alpha = 1
      self.window?.isHidden = false
      self.observeAppLifecycle()
    }
    #endif
  }

  /// Replaces the line under the spinner, e.g. once the manifest has arrived.
  @objc
  public func setStatus(_ status: String) {
    #if os(iOS) || os(tvOS)
    onMain { [weak self] in
      self?.viewController?.setStatus(status)
    }
    #endif
  }

  @objc
  public func hide() {
    #if os(iOS) || os(tvOS)
    onMain { [weak self] in
      guard let self, let window = self.window else {
        return
      }
      self.stopObserving()
      let generation = self.generation
      UIView.animate(
        withDuration: 0.2,
        animations: {
          window.alpha = 0
        },
        completion: { _ in
          // A new load may have started while fading out.
          guard generation == self.generation else {
            return
          }
          window.isHidden = true
          self.window = nil
          self.viewController = nil
        }
      )
    }
    #endif
  }

  @objc
  public var isVisible: Bool {
    #if os(iOS) || os(tvOS)
    return window?.isHidden == false
    #else
    return false
    #endif
  }

  // MARK: - Private

  /// React Native's own notifications say when the project is on screen or has failed. Matched by
  /// name so this file does not depend on which React Native architecture posts them.
  private func observeAppLifecycle() {
    stopObserving()
    let center = NotificationCenter.default
    let generation = self.generation
    let hide: (Notification) -> Void = { [weak self] _ in
      guard let self, generation == self.generation else {
        return
      }
      self.hide()
    }
    observers.append(
      center.addObserver(
        forName: Notification.Name("RCTContentDidAppearNotification"),
        object: nil,
        queue: .main,
        using: hide
      )
    )
    observers.append(
      center.addObserver(
        forName: Notification.Name("RCTJavaScriptDidFailToLoadNotification"),
        object: nil,
        queue: .main,
        using: hide
      )
    )
    observers.append(
      center.addObserver(
        forName: Notification.Name("RCTJavaScriptDidLoadNotification"),
        object: nil,
        queue: .main
      ) { [weak self] _ in
        guard let self, generation == self.generation else {
          return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.hideAfterJavaScriptLoad) { [weak self] in
          guard let self, generation == self.generation else {
            return
          }
          self.hide()
        }
      }
    )
  }

  private func stopObserving() {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers.removeAll()
  }

  private func onMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread {
      block()
    } else {
      DispatchQueue.main.async(execute: block)
    }
  }

  static func displayName(for url: URL) -> String {
    guard let host = url.host, !host.isEmpty else {
      return url.absoluteString
    }
    if let port = url.port {
      return "\(host):\(port)"
    }
    return host
  }

  #if os(iOS) || os(tvOS)
  private static func makeWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first else {
      return nil
    }
    let window = UIWindow(windowScene: scene)
    window.windowLevel = .normal + 1
    window.backgroundColor = .clear
    return window
  }
  #endif
}

#if os(iOS) || os(tvOS)
private final class LoadingViewController: UIViewController {
  private let spinner = UIActivityIndicatorView(style: .large)
  private let titleLabel = UILabel()
  private let projectLabel = UILabel()
  private let statusLabel = UILabel()

  override func viewDidLoad() {
    super.viewDidLoad()
    #if os(tvOS)
    view.backgroundColor = .black
    #else
    view.backgroundColor = .systemBackground
    #endif
    view.accessibilityViewIsModal = true

    spinner.startAnimating()

    titleLabel.text = NSLocalizedString("Opening project", comment: "")
    titleLabel.font = .preferredFont(forTextStyle: .headline)
    titleLabel.textAlignment = .center

    projectLabel.font = .preferredFont(forTextStyle: .subheadline)
    projectLabel.textColor = .secondaryLabel
    projectLabel.textAlignment = .center
    projectLabel.numberOfLines = 2
    projectLabel.lineBreakMode = .byTruncatingMiddle

    statusLabel.font = .preferredFont(forTextStyle: .footnote)
    statusLabel.textColor = .secondaryLabel
    statusLabel.textAlignment = .center
    statusLabel.numberOfLines = 0

    let stack = UIStackView(arrangedSubviews: [spinner, titleLabel, projectLabel, statusLabel])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 12
    stack.setCustomSpacing(24, after: spinner)
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
    ])
  }

  func setProject(_ name: String) {
    loadViewIfNeeded()
    projectLabel.text = name
  }

  func setStatus(_ status: String) {
    loadViewIfNeeded()
    statusLabel.text = status
    UIAccessibility.post(notification: .announcement, argument: status)
  }
}
#endif
