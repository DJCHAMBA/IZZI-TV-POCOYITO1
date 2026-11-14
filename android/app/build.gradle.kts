plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.djchamba.izzitvpocoyito"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.djchamba.izzitvpocoyito"
        minSdk = 23
        targetSdk = 35
        versionCode = 8
        versionName = "1.0.0"
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core-ktx:1.15.0")
}
