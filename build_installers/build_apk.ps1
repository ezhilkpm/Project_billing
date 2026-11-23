# build_apk.ps1 - Automated Android APK Builder for ChefPulse POS
$ErrorActionPreference = "Stop"

$JavaHome = "C:\Program Files\Android\Android Studio\jbr"
$env:JAVA_HOME = $JavaHome
$env:PATH = "$JavaHome\bin;$env:PATH"

$SdkRoot = "C:\Users\Ezhilarasan.Raja\AppData\Local\Android\Sdk"
$AndroidJar = "$SdkRoot\platforms\android-34\android.jar"
$BuildTools = "$SdkRoot\build-tools\34.0.0"
$Aapt = "$BuildTools\aapt.exe"
$D8 = "$BuildTools\d8.bat"
$ZipAlign = "$BuildTools\zipalign.exe"
$ApkSigner = "$BuildTools\apksigner.bat"

Write-Host "🚀 Building ChefPulse POS Android APK..."

# 1. Prepare Directory Structure
$BaseDir = "d:\Project\Project_billing\build_apk"
$ResDir = "$BaseDir\res"
$GenDir = "$BaseDir\gen"
$BinDir = "$BaseDir\bin"
$DexDir = "$BaseDir\dex"
$OutDir = "d:\Project\Project_billing\public\downloads"

Remove-Item "$BaseDir\bin", "$BaseDir\dex", "$BaseDir\gen" -Recurse -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path "$ResDir\values", "$ResDir\drawable", "$GenDir", "$BinDir", "$DexDir", "$OutDir" | Out-Null

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# 2. Write AndroidManifest.xml
$Manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.chefpulse.pos"
    android:versionCode="400"
    android:versionName="4.0.0">

    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.BLUETOOTH" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />

    <application
        android:label="@string/app_name"
        android:icon="@drawable/ic_launcher"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen"
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:label="@string/app_name">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
"@
[System.IO.File]::WriteAllText("$BaseDir\AndroidManifest.xml", $Manifest.Trim(), $Utf8NoBom)

# 3. Write strings.xml
$Strings = @"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">ChefPulse POS</string>
</resources>
"@
[System.IO.File]::WriteAllText("$ResDir\values\strings.xml", $Strings.Trim(), $Utf8NoBom)

# 4. Generate Valid 192x192 PNG Icon
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 192, 192
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(245, 158, 11))
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(15, 23, 42))
$font = New-Object System.Drawing.Font("Arial", 46, [System.Drawing.FontStyle]::Bold)
$g.DrawString("POS", $font, $brush, 22, 55)
$bmp.Save("$ResDir\drawable\ic_launcher.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$g.Dispose()

# 5. Write MainActivity.java (Without BOM!)
$JavaCode = @"
package com.chefpulse.pos;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.webkit.WebChromeClient;
import android.view.Window;
import android.view.WindowManager;

public class MainActivity extends Activity {
    private WebView webView;

    static class PosWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            view.loadUrl(url);
            return true;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                             WindowManager.LayoutParams.FLAG_FULLSCREEN);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        webView.setWebViewClient(new PosWebViewClient());
        webView.setWebChromeClient(new WebChromeClient());

        // Connect to ChefPulse POS server
        webView.loadUrl("http://192.168.1.2:4000");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
"@
New-Item -ItemType Directory -Force -Path "$BaseDir\src\com\chefpulse\pos" | Out-Null
[System.IO.File]::WriteAllText("$BaseDir\src\com\chefpulse\pos\MainActivity.java", $JavaCode.Trim(), $Utf8NoBom)

# 6. Generate R.java with aapt
Write-Host "[1/6] Generating R.java with AAPT..."
& $Aapt package -f -m -J $GenDir -M "$BaseDir\AndroidManifest.xml" -S $ResDir -I $AndroidJar

# 7. Compile Java sources to .class
Write-Host "[2/6] Compiling Java source files..."
$JavaFiles = Get-ChildItem -Recurse -Path "$BaseDir\src", "$GenDir" -Filter "*.java" | Select-Object -ExpandProperty FullName
& "$JavaHome\bin\javac.exe" -source 8 -target 8 -g:none -cp $AndroidJar -d $BinDir $JavaFiles

# 8. Compile .class files to classes.dex with D8
Write-Host "[3/6] Compiling classes.dex with D8..."
$ClassFiles = Get-ChildItem -Recurse -Path $BinDir -Filter "*.class" | Select-Object -ExpandProperty FullName
& $D8 --output $DexDir --lib $AndroidJar $ClassFiles

# 9. Package base resources APK with aapt
Write-Host "[4/6] Packaging base resources into APK..."
$UnsignedApk = "$BaseDir\ChefPulse_unsigned.apk"
Remove-Item $UnsignedApk -ErrorAction SilentlyContinue
& $Aapt package -f -M "$BaseDir\AndroidManifest.xml" -S $ResDir -I $AndroidJar -F $UnsignedApk

# 10. Add classes.dex into APK
Write-Host "[5/6] Adding classes.dex to APK package..."
Set-Location $DexDir
& "$JavaHome\bin\jar.exe" -uf $UnsignedApk "classes.dex"
Set-Location "d:\Project\Project_billing"

# 11. Create Debug Keystore & Sign APK
Write-Host "[6/6] Generating debug keystore & signing APK with Apksigner..."
$KeystorePath = "$BaseDir\debug.keystore"
if (-not (Test-Path $KeystorePath)) {
    & "$JavaHome\bin\keytool.exe" -genkey -v -keystore $KeystorePath -alias androiddebugkey -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=ChefPulse, OU=POS, O=ClassicHotel, L=Bangalore, ST=Karnataka, C=IN"
}

$FinalApk = "$OutDir\ChefPulse_POS_Captain.apk"
Remove-Item $FinalApk -ErrorAction SilentlyContinue

# ZipAlign APK
$AlignedApk = "$BaseDir\ChefPulse_aligned.apk"
Remove-Item $AlignedApk -ErrorAction SilentlyContinue
& $ZipAlign -f 4 $UnsignedApk $AlignedApk

# Sign with apksigner
& $ApkSigner sign --ks $KeystorePath --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android --out $FinalApk $AlignedApk

Write-Host "`n🎉 SUCCESS! ChefPulse Android APK built & signed successfully:"
Get-Item $FinalApk | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
