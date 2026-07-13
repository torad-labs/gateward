pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "golden"

include(":app")
include(":core:model")
include(":core:ui")
include(":feature:listings:presentation")
include(":feature:listings:domain")
include(":feature:listings:data")
include(":feature:detail:presentation")
include(":feature:detail:domain")
include(":feature:detail:data")
include(":feature:favorites:presentation")
include(":feature:favorites:domain")
include(":feature:favorites:data")
